import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const NL_THEME = 'Dit jaar doen we een regift';

async function setup(names = ['Ada', 'Ben', 'Cor']) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names });
  return { ...t, ...seeded, clock, ada: seeded.people[0] };
}

test('first visit shows the welcome screen with theme, date and one button', async () => {
  const { app, ada } = await setup();
  const res = await app.inject(`/p/${ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('<html lang="nl">'));
  assert.ok(res.body.includes('Hallo Ada!'));
  assert.ok(res.body.includes(NL_THEME));
  assert.ok(res.body.includes('vrijdag 18 december'));
  assert.ok(res.body.includes(`href="/p/${ada.token}/about"`));
  assert.ok(textOf(res.body).includes('Vertel iets over jezelf'));
  assert.ok(res.body.includes(`action="/p/${ada.token}/lang"`));
  assert.ok(!res.body.includes('Ben'));
});

test('first visit sets visitedAt and a later visit keeps it', async () => {
  const { app, ctx, ada, clock } = await setup();
  assert.equal(ada.visitedAt, null);
  await app.inject(`/p/${ada.token}`);
  const first = ctx.repo.getParticipant(ada.id).visitedAt;
  assert.equal(first, new Date(T0).toISOString());
  clock.ms += 3_600_000;
  await app.inject(`/p/${ada.token}`);
  assert.equal(ctx.repo.getParticipant(ada.id).visitedAt, first);
});

test('the about form has every wish field, the theme and the date', async () => {
  const { app, ada } = await setup();
  const res = await app.inject(`/p/${ada.token}/about`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`action="/p/${ada.token}/about"`));
  for (const name of ['hobbies', 'pets_other', 'avoid', 'other', 'detail_chocolate']) {
    assert.ok(res.body.includes(`name="${name}"`), name);
  }
  assert.ok(res.body.includes('name="likes" value="tea"'));
  assert.ok(res.body.includes('name="pets" value="cat"'));
  assert.ok(res.body.includes('Thee'));
  assert.ok(res.body.includes(NL_THEME));
  assert.ok(res.body.includes('vrijdag 18 december'));
});

test('the about form shows the organiser question, escaped, and the generic prompt elsewhere', async () => {
  const { app, ctx, ada, group } = await setup();
  ctx.repo.updateEvent(group.eventId, {
    wishOptions: [
      { id: 'books', label: 'Boeken', detail: true, question: 'Welke <b>schrijver</b>?' },
      { id: 'wol-ab12', label: 'Wol', detail: true },
      { id: 'chocolate', label: 'Chocolade', detail: true },
    ],
  });
  const res = await app.inject(`/p/${ada.token}/about`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Welke &lt;b&gt;schrijver&lt;/b&gt;?'));
  assert.ok(!res.body.includes('<b>schrijver'));
  assert.ok(res.body.includes('name="detail_wol-ab12"'));
  assert.ok(res.body.includes('Iets in het bijzonder?'));
  assert.ok(res.body.includes('Welke smaak?'));
});

test('saving wishes in a closed group leads to the waiting screen', async () => {
  const { app, ctx, post, ada, clock } = await setup();
  clock.ms += 60_000;
  const res = await post(`/p/${ada.token}/about`, {
    hobbies: 'Gardening',
    likes: ['tea', 'chocolate'],
    detail_chocolate: 'dark',
    pets: 'cat',
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}`);
  const stored = ctx.repo.getParticipant(ada.id);
  assert.equal(stored.wishes.hobbies, 'Gardening');
  assert.deepEqual(stored.wishes.likes, ['tea', 'chocolate']);
  assert.deepEqual(stored.wishes.likeDetails, { chocolate: 'dark' });
  assert.equal(stored.wishesUpdatedAt, new Date(clock.ms).toISOString());

  const page = await app.inject(`/p/${ada.token}`);
  assert.ok(page.body.includes('Het trekken begint binnenkort, je krijgt een e-mail.'));
  assert.ok(page.body.includes(`href="/p/${ada.token}/about"`));
  assert.ok(page.body.includes(NL_THEME));
  assert.ok(page.body.includes('vrijdag 18 december'));

  const form = await app.inject(`/p/${ada.token}/about`);
  assert.ok(form.body.includes('value="Gardening"') || form.body.includes('>Gardening</textarea>'));
  assert.match(form.body, /name="likes" value="tea" checked/);
  assert.match(form.body, /name="pets" value="cat" checked/);
  assert.doesNotMatch(form.body, /name="likes" value="wine" checked/);
});

// Fifteen minutes later the wish-update lines say something about this
// person's giver, so the save itself names only the group.
test('a wish save logs the group, not the participant', async () => {
  const { post, ada, group, logs } = await setup();
  await post(`/p/${ada.token}/about`, { hobbies: 'reading' });
  const line = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'wishes_saved');
  assert.equal(line.group_id, group.id);
  assert.ok(!Object.hasOwn(line, 'participant_id'));
});

test('saved HTML comes back escaped', async () => {
  const { app, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, { hobbies: '<script>alert(1)</script>', pets_other: '"><b>x' });
  const form = await app.inject(`/p/${ada.token}/about`);
  assert.ok(form.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!form.body.includes('<script>alert(1)'));
  assert.ok(!form.body.includes('"><b>x'));
});

test('a 5000 character field is stored as 1000', async () => {
  const { ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/about`, { other: 'x'.repeat(5000) });
  assert.equal(res.statusCode, 303);
  assert.equal(ctx.repo.getParticipant(ada.id).wishes.other.length, 1000);
});

test('an unknown token gets the HTML 404 page', async () => {
  const { app } = await setup();
  for (const url of ['/p/unknown-token', '/p/unknown-token/about']) {
    const res = await app.inject(url);
    assert.equal(res.statusCode, 404);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.ok(res.body.includes('Deze pagina bestaat niet.'));
  }
});

test('the language switch stores a known language and goes back', async () => {
  const { app, ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/lang`, { lang: 'en' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}`);
  assert.equal(ctx.repo.getParticipant(ada.id).language, 'en');
  const page = await app.inject(`/p/${ada.token}`);
  assert.ok(page.body.includes('<html lang="en">'));
  assert.ok(page.body.includes('Hello Ada!'));
  assert.ok(page.body.includes('This year it&#39;s a regift'));

  const fromAbout = await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'about' });
  assert.equal(fromAbout.headers.location, `/p/${ada.token}/about`);
  const elsewhere = await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'https://evil.example' });
  assert.equal(elsewhere.headers.location, `/p/${ada.token}`);
});

// The switch sits under the form, close to Save; answers typed but not yet
// saved must survive the reload into the other language.
test('switching language on the about form keeps what was typed', async () => {
  const { app, ctx, post, ada } = await setup();
  const form = await app.inject(`/p/${ada.token}/about`);
  assert.match(form.body, /<form class="about" id="about-form" method="post"/);
  assert.match(form.body, new RegExp(`<button type="submit" name="lang" value="en" lang="en" form="about-form" formaction="/p/${ada.token}/lang">`));

  const res = await post(`/p/${ada.token}/lang`, {
    lang: 'en', from: 'about', sections: 'hobbies likes pets avoid other', hobbies: 'Yoga en wandelen', likes: 'tea',
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}/about`);
  const stored = ctx.repo.getParticipant(ada.id);
  assert.equal(stored.language, 'en');
  assert.equal(stored.wishes.hobbies, 'Yoga en wandelen');
  assert.deepEqual(stored.wishes.likes, ['tea']);
  const again = await app.inject(`/p/${ada.token}/about`);
  assert.ok(again.body.includes('Yoga en wandelen'));
});

test('switching language with the answers unchanged tells the giver nothing', async () => {
  const { ctx, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, { hobbies: 'Breien', likes: 'tea' });
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  const before = ctx.repo.getParticipant(ada.id);
  await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', sections: 'hobbies likes pets avoid other', hobbies: 'Breien', likes: 'tea' });
  const after = ctx.repo.getParticipant(ada.id);
  assert.equal(after.language, 'en');
  assert.equal(after.notifyGiverDueAt, null);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
});

test('the language switch keeps answers of sections the posted form did not show', async () => {
  const { ctx, post, ada, event } = await setup();
  await post(`/p/${ada.token}/about`, { hobbies: 'Breien', avoid: 'Noten', other: 'Graag iets kleins' });
  // A form loaded before the organiser showed "avoid" again lists only hobbies.
  await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', sections: 'hobbies', hobbies: 'Breien en lezen', avoid: '' });
  let wishes = ctx.repo.getParticipant(ada.id).wishes;
  assert.equal(wishes.hobbies, 'Breien en lezen');
  assert.equal(wishes.avoid, 'Noten');
  // A section the organiser hid keeps its answer through the switch too.
  ctx.repo.updateEvent(event.id, { formConfig: { sections: { other: { show: false } } } });
  await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'about', sections: 'hobbies likes pets avoid', hobbies: 'Breien en lezen', avoid: 'Noten', other: '' });
  wishes = ctx.repo.getParticipant(ada.id).wishes;
  assert.equal(wishes.other, 'Graag iets kleins');
});

test('the on-behalf wish form has no language switch', async () => {
  const { adminGet, ada } = await setup();
  const res = await adminGet(`/admin/participants/${ada.id}/about`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('class="lang-switch"'), false);
  assert.equal(res.body.includes('formaction='), false);
});

test('switching language away from the form leaves the wishes alone', async () => {
  const { ctx, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, { hobbies: 'Breien' });
  await post(`/p/${ada.token}/lang`, { lang: 'en', hobbies: 'Nooit' });
  await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'about' });
  assert.equal(ctx.repo.getParticipant(ada.id).wishes.hobbies, 'Breien');
});

test('a junk language is refused and the stored language is unchanged', async () => {
  const { ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/lang`, { lang: '!!' });
  assert.equal(res.statusCode, 400);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes('Dit verzoek klopt niet, ga terug'));
  assert.equal(ctx.repo.getParticipant(ada.id).language, 'nl');
  const missing = await post(`/p/${ada.token}/lang`, {});
  assert.equal(missing.statusCode, 400);
});

test('25 participants behind one IP each get through a whole visit in a minute', async () => {
  const names = Array.from({ length: 25 }, (_, i) => `Eva${i}`);
  const { app, post, people } = await setup(names);
  for (const p of people) {
    assert.equal((await app.inject(`/p/${p.token}`)).statusCode, 200);
    assert.equal((await app.inject(`/p/${p.token}/about`)).statusCode, 200);
    assert.equal((await post(`/p/${p.token}/about`, { hobbies: 'Yoga' })).statusCode, 303);
  }
});

test('21 unknown tokens from one IP block every participant page until the window passes', async () => {
  const { app, ada, clock } = await setup();
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await app.inject(`/p/guess-${i}`)).statusCode, 404);
  }
  const blocked = await app.inject('/p/guess-20');
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers['content-type'], /^text\/html/);
  assert.ok(blocked.body.includes('Even te veel tegelijk.'));

  assert.equal((await app.inject(`/p/${ada.token}`)).statusCode, 429);
  assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 429);
  assert.equal((await app.inject({ url: `/p/${ada.token}`, remoteAddress: '192.0.2.7' })).statusCode, 200);

  clock.ms += 60_000;
  assert.equal((await app.inject(`/p/${ada.token}`)).statusCode, 200);
});

test('valid-token traffic from one IP has a ceiling', async () => {
  const { app, ada } = await setup();
  for (let i = 0; i < 600; i += 1) {
    assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 200);
  }
  assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 429);
});

test('the waiting screen does not promise an email to someone without one', async () => {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], withEmail: false });
  await t.post(`/p/${people[0].token}/about`, { hobbies: 'Yoga' });
  const page = await t.app.inject(`/p/${people[0].token}`);
  assert.ok(page.body.includes('De organisator laat je weten'));
  assert.ok(!page.body.includes('e-mail'));
});

test('with email off the waiting screen does not promise an email, even to someone with an address', async () => {
  const t = await setup();
  t.mailer.enabled = false;
  await t.post(`/p/${t.ada.token}/about`, { hobbies: 'Yoga' });
  const page = await t.app.inject(`/p/${t.ada.token}`);
  assert.ok(page.body.includes('De organisator laat je weten'));
  assert.ok(!page.body.includes('e-mail'));
});

test('a HEAD request does not count as a visit', async () => {
  const { app, ctx, ada } = await setup();
  const res = await app.inject({ method: 'HEAD', url: `/p/${ada.token}` });
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.repo.getParticipant(ada.id).visitedAt, null);
});

test('a blocked IP gets no participant page through odd spellings of the path', async () => {
  const { app, ada } = await setup();
  for (let i = 0; i < 20; i += 1) await app.inject(`/p/guess-${i}`);
  for (const url of [`//p/${ada.token}`, `/%70/${ada.token}`, `/./p/${ada.token}`, `/x/../p/${ada.token}/about`]) {
    const res = await app.inject(url);
    assert.ok([404, 429].includes(res.statusCode), `${url.replace(ada.token, ':token')} ${res.statusCode}`);
    assert.ok(!res.body.includes('Ada'));
  }
});
