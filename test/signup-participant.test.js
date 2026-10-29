import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escape } from '../src/html.js';
import { t as tr } from '../src/i18n/index.js';
import { tick } from '../src/scheduler.js';
import { newFormToken } from '../src/submit-log.js';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const DEADLINE = '2026-11-20';
// The first moment after the deadline day, Amsterdam time.
const AFTER_DEADLINE = Date.parse('2026-11-20T23:00:00.000Z');

async function setup({ sent = true } = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], invited: false });
  const eventId = seeded.event.id;
  const on = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: DEADLINE });
  assert.equal(on.statusCode, 303, on.body);
  if (sent) {
    const res = await t.adminPost(`/admin/events/${eventId}/signup/send`, { formToken: newFormToken() });
    assert.equal(res.statusCode, 303, res.body);
  }
  return { ...t, ...seeded, eventId, clock, ada: seeded.people[0] };
}

const stored = (t, id) => t.ctx.repo.getParticipant(id);
const answer = (t, who, value) => t.post(`/p/${who.token}/signup`, { answer: value });
const msgs = (t) => t.logs.map((line) => JSON.parse(line));
const has = (body, key, vars) => textOf(body).includes(tr('nl', key, vars));

// The value of each answer button, in page order.
function buttons(body) {
  return [...body.matchAll(/<button type="submit" class="([^"]*)" name="answer" value="(yes|no)"/g)]
    .map(([, cls, value]) => ({ value, primary: !cls.includes('secondary') }));
}

test('an open sign-up asks with the event, theme, exchange, deadline and two buttons', async () => {
  const t = await setup();
  const res = await t.app.inject(`/p/${t.ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(has(res.body, 'signup.question', { event: 'Gifts 2026' }));
  assert.ok(res.body.includes('Dit jaar doen we een regift'));
  assert.ok(res.body.includes('vrijdag 18 december'));
  assert.ok(has(res.body, 'signup.deadline', { date: 'vrijdag 20 november' }));
  assert.ok(res.body.includes(`action="/p/${t.ada.token}/signup"`));
  assert.deepEqual(buttons(res.body).map((b) => b.value), ['yes', 'no']);
  assert.equal(stored(t, t.ada.id).signup, null);
});

for (const method of ['GET', 'HEAD']) {
  test(`${method} of a link with ?a=yes shows yes first and records no answer`, async () => {
    const t = await setup();
    const res = await t.app.inject({ method, url: `/p/${t.ada.token}?a=yes` });
    assert.equal(res.statusCode, 200);
    if (method === 'GET') {
      assert.deepEqual(buttons(res.body), [{ value: 'yes', primary: true }, { value: 'no', primary: false }]);
    }
    const after = stored(t, t.ada.id);
    assert.equal(after.signup, null);
    assert.equal(after.signupAt, null);
    assert.ok(!msgs(t).some((l) => l.msg === 'signup_answer'));
  });
}

test('a link with ?a=no shows no first as the main button', async () => {
  const t = await setup();
  const res = await t.app.inject(`/p/${t.ada.token}?a=no`);
  assert.deepEqual(buttons(res.body), [{ value: 'no', primary: true }, { value: 'yes', primary: false }]);
  const odd = await t.app.inject(`/p/${t.ada.token}?a=maybe`);
  assert.deepEqual(buttons(odd.body).map((b) => b.value), ['yes', 'no']);
  assert.equal(stored(t, t.ada.id).signup, null);
});

test('the last answer counts and the page says what was answered', async () => {
  const t = await setup();
  const steps = [['yes', 'signup.joined', 'no'], ['no', 'signup.notJoined', 'yes'], ['yes', 'signup.joined', 'no']];
  for (const [value, textKey, switchTo] of steps) {
    t.clock.ms += 60_000;
    const res = await answer(t, t.ada, value);
    assert.equal(res.statusCode, 303, res.body);
    assert.equal(res.headers.location, `/p/${t.ada.token}`);
    const after = stored(t, t.ada.id);
    assert.equal(after.signup, value);
    assert.equal(after.signupAt, new Date(t.clock.ms).toISOString());
    const page = await t.app.inject(`/p/${t.ada.token}`);
    assert.ok(has(page.body, textKey));
    assert.deepEqual(buttons(page.body).map((b) => b.value), [switchTo]);
  }
  const lines = msgs(t).filter((l) => l.msg === 'signup_answer');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.participant_id, t.ada.id);
    assert.ok(!JSON.stringify(line).includes('yes') && !JSON.stringify(line).includes('"no"'), JSON.stringify(line));
  }
});

test('an answer other than yes or no is refused', async () => {
  const t = await setup();
  const res = await answer(t, t.ada, 'maybe');
  assert.equal(res.statusCode, 400);
  assert.equal(stored(t, t.ada.id).signup, null);
});

test('an answer after the deadline gets the closed page and changes nothing, and the next tick closes the sign-up', async () => {
  const t = await setup();
  await answer(t, t.ada, 'no');
  const before = stored(t, t.ada.id);
  t.clock.ms = AFTER_DEADLINE;
  const res = await answer(t, t.ada, 'yes');
  assert.equal(res.statusCode, 409);
  assert.ok(has(res.body, 'signup.closed'));
  assert.ok(has(res.body, 'signup.notJoined'));
  assert.deepEqual(buttons(res.body), []);
  const after = stored(t, t.ada.id);
  assert.equal(after.signup, 'no');
  assert.equal(after.signupAt, before.signupAt);

  assert.equal(t.ctx.repo.getEvent(t.eventId).signupClosedAt, null);
  await tick(t.ctx);
  assert.equal(t.ctx.repo.getEvent(t.eventId).signupClosedAt, new Date(AFTER_DEADLINE).toISOString());
  const line = msgs(t).find((l) => l.msg === 'signup_closed');
  assert.equal(line.by, 'deadline');
  assert.equal(line.event_id, t.eventId);
});

test('the closed page shows no answer as not joining and that the organiser can still add you', async () => {
  const t = await setup();
  await t.adminPost(`/admin/events/${t.eventId}/signup/close`);
  const res = await t.app.inject(`/p/${t.ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(has(res.body, 'signup.closed'));
  assert.ok(has(res.body, 'signup.notJoined'));
  assert.ok(has(res.body, 'signup.askToJoin'));
  assert.deepEqual(buttons(res.body), []);
});

test('a sign-up not sent yet tells the participant to wait and offers no answer', async () => {
  const t = await setup({ sent: false });
  const res = await t.app.inject(`/p/${t.ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(has(res.body, 'signup.setup'));
  assert.ok(textOf(res.body).includes('De organisator vraagt je binnenkort of je meedoet.'));
  assert.deepEqual(buttons(res.body), []);
  assert.ok(!res.body.includes(`action="/p/${t.ada.token}/signup"`));
  const post = await answer(t, t.ada, 'yes');
  assert.equal(post.statusCode, 409);
  assert.ok(has(post.body, 'signup.setup'));
  assert.equal(stored(t, t.ada.id).signup, null);
});

test('the answer page shows in English for an English participant', async () => {
  const t = await setup();
  t.ctx.repo.updateParticipant(t.ada.id, { language: 'en' });
  const res = await t.app.inject(`/p/${t.ada.token}`);
  assert.ok(textOf(res.body).includes(tr('en', 'signup.question', { event: 'Gifts 2026' })));
  assert.ok(res.body.includes(escape(tr('en', 'signup.yes'))));
});
