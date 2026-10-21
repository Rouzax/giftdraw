import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawFor } from '../src/people.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-20T10:00:00.000Z');
const NAMES = ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'];

async function setup({ opened = true } = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: NAMES, opened });
  const ada = seeded.people[0];
  const receiver = t.ctx.repo.getParticipant(ada.receiverId);
  return { ...t, ...seeded, clock, ada, receiver };
}

const count = (body, needle) => body.split(needle).length - 1;

test('an open group shows the draw screen with one button', async () => {
  const { app, ada, receiver } = await setup();
  const res = await app.inject(`/p/${ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Je mag een naam trekken'));
  assert.ok(res.body.includes(`action="/p/${ada.token}/draw"`));
  assert.equal(count(res.body, 'class="button"'), 1);
  assert.ok(res.body.includes('Trek een naam'));
  assert.ok(!res.body.includes(receiver.name));
  assert.ok(!res.body.includes('data-reveal'));
});

test('pressing the button redirects to the reveal without drawing yet', async () => {
  const { ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/draw`);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}?reveal=1`);
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, null);
});

test('loading the reveal sets drawnAt and shows the receiver with the reveal', async () => {
  const { app, ctx, ada, receiver, clock, logs } = await setup();
  ctx.repo.updateParticipant(receiver.id, { wishes: { hobbies: 'Knitting', likes: ['tea'] } });
  clock.ms += 60_000;
  const res = await app.inject(`/p/${ada.token}?reveal=1`);
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, new Date(clock.ms).toISOString());
  assert.ok(res.body.includes('Jij geeft een cadeautje aan'));
  assert.ok(res.body.includes(receiver.name));
  assert.ok(res.body.includes('data-reveal'));
  assert.match(res.body, /<script src="\/static\/js\/reveal\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(res.body.includes('Knitting'));
  assert.ok(res.body.includes('thee'));
  assert.ok(res.body.includes('Dit jaar doen we een regift'));
  assert.ok(res.body.includes('vrijdag 18 december'));
  assert.ok(res.body.includes(`href="/p/${ada.token}/about"`));
  const drawn = logs.map((line) => JSON.parse(line)).filter((entry) => entry.msg === 'participant_drawn');
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].participant_id, ada.id);
  assert.ok(!logs.join('').includes(ada.token));
});

test('a second reveal load shows the plain result and keeps the first drawnAt', async () => {
  const { app, ctx, ada, receiver, clock } = await setup();
  await app.inject(`/p/${ada.token}?reveal=1`);
  const first = ctx.repo.getParticipant(ada.id).drawnAt;
  clock.ms += 3_600_000;
  for (const url of [`/p/${ada.token}?reveal=1`, `/p/${ada.token}`]) {
    const res = await app.inject(url);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes(receiver.name), url);
    assert.ok(!res.body.includes('data-reveal'), url);
    assert.ok(!res.body.includes('reveal.js'), url);
  }
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, first);
});

test('in a closed group neither request draws', async () => {
  const { app, ctx, post, ada, receiver } = await setup({ opened: false });
  const res = await post(`/p/${ada.token}/draw`);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}`);
  const page = await app.inject(`/p/${ada.token}?reveal=1`);
  assert.equal(page.statusCode, 200);
  assert.ok(!page.body.includes('data-reveal'));
  assert.ok(!page.body.includes(receiver.name));
  assert.ok(page.body.includes('Hallo Ada!'));
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, null);
});

test('a HEAD request for the reveal does not draw', async () => {
  const { app, ctx, ada } = await setup();
  const res = await app.inject({ method: 'HEAD', url: `/p/${ada.token}?reveal=1` });
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, null);
});

test('the result names nobody from the group except the receiver', async () => {
  const { app, ada, receiver } = await setup();
  for (const url of [`/p/${ada.token}?reveal=1`, `/p/${ada.token}`]) {
    const res = await app.inject(url);
    for (const name of NAMES.filter((n) => n !== receiver.name)) {
      assert.ok(!res.body.includes(name), `${url} mentions ${name}`);
    }
  }
});

test('a receiver without wishes gets a friendly line, in the chosen language', async () => {
  const { app, ctx, ada, receiver } = await setup();
  ctx.repo.updateParticipant(ada.id, { language: 'en' });
  const res = await app.inject(`/p/${ada.token}?reveal=1`);
  assert.ok(res.body.includes('<html lang="en">'));
  assert.ok(res.body.includes('You give a present to'));
  assert.ok(res.body.includes(`${receiver.name} has not filled in anything yet.`));
  assert.ok(res.body.includes('Tap to see the name straight away'));
});

test('drawFor needs an open group and sets drawnAt only once', async () => {
  const closed = await setup({ opened: false });
  assert.throws(() => drawFor(closed.ctx, closed.ada.id), /not open/);
  assert.equal(closed.ctx.repo.getParticipant(closed.ada.id).drawnAt, null);

  const { ctx, ada, receiver, clock } = await setup();
  const first = drawFor(ctx, ada.id);
  assert.equal(first.firstTime, true);
  assert.equal(first.receiver.id, receiver.id);
  const drawnAt = ctx.repo.getParticipant(ada.id).drawnAt;
  clock.ms += 60_000;
  const again = drawFor(ctx, ada.id);
  assert.equal(again.firstTime, false);
  assert.equal(again.receiver.id, receiver.id);
  assert.equal(ctx.repo.getParticipant(ada.id).drawnAt, drawnAt);
});

test('the reveal script is served', async () => {
  const { app } = await setup();
  const res = await app.inject('/static/js/reveal.js');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('the result invites someone without wishes to fill them in, others to change them', async () => {
  const { app, ada, ctx } = await setup();
  drawFor(ctx, ada.id);
  let res = await app.inject(`/p/${ada.token}`);
  assert.ok(res.body.includes('Vertel wat jij leuk vindt'));
  assert.ok(!res.body.includes('Mijn eigen antwoorden aanpassen'));
  ctx.repo.updateParticipant(ada.id, { wishes: { likes: [], pets: [], hobbies: 'tuinieren' } });
  res = await app.inject(`/p/${ada.token}`);
  assert.ok(res.body.includes('Mijn eigen antwoorden aanpassen'));
});
