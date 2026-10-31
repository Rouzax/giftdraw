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

// The value of each answer button, in page order, and how it looks: the
// main button, the quieter second button, or the small link-style one.
function buttons(body) {
  return [...body.matchAll(/<button type="submit" class="([^"]*)" name="answer" value="(yes|no)"/g)]
    .map(([, cls, value]) => {
      if (cls.includes('link-button')) return { value, kind: 'link' };
      return { value, kind: cls.includes('secondary') ? 'secondary' : 'main' };
    });
}

const changeHref = (who) => `href="/p/${who.token}?change=1"`;

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
  test(`${method} of a link with ?a=yes asks to confirm yes with one large button and records no answer`, async () => {
    const t = await setup();
    const res = await t.app.inject({ method, url: `/p/${t.ada.token}?a=yes` });
    assert.equal(res.statusCode, 200);
    if (method === 'GET') {
      assert.ok(has(res.body, 'signup.confirm'));
      assert.deepEqual(buttons(res.body), [{ value: 'yes', kind: 'main' }, { value: 'no', kind: 'link' }]);
      assert.ok(res.body.includes(escape(tr('nl', 'signup.yes'))));
      assert.ok(res.body.includes(escape(tr('nl', 'signup.otherNo'))));
    }
    const after = stored(t, t.ada.id);
    assert.equal(after.signup, null);
    assert.equal(after.signupAt, null);
    assert.ok(!msgs(t).some((l) => l.msg === 'signup_answer'));
  });
}

test('a link with ?a=no asks to confirm no, with yes as the small link', async () => {
  const t = await setup();
  const res = await t.app.inject(`/p/${t.ada.token}?a=no`);
  assert.ok(has(res.body, 'signup.confirm'));
  assert.deepEqual(buttons(res.body), [{ value: 'no', kind: 'main' }, { value: 'yes', kind: 'link' }]);
  assert.ok(res.body.includes(escape(tr('nl', 'signup.otherYes'))));
  const odd = await t.app.inject(`/p/${t.ada.token}?a=maybe`);
  assert.ok(!has(odd.body, 'signup.confirm'));
  assert.deepEqual(buttons(odd.body), [{ value: 'yes', kind: 'main' }, { value: 'no', kind: 'secondary' }]);
  assert.equal(stored(t, t.ada.id).signup, null);
});

test('a mail link for the other answer asks to confirm it and says what the answer is now', async () => {
  const t = await setup();
  await answer(t, t.ada, 'yes');
  const res = await t.app.inject(`/p/${t.ada.token}?a=no`);
  assert.ok(has(res.body, 'signup.confirm'));
  assert.ok(has(res.body, 'signup.nowYes'));
  assert.deepEqual(buttons(res.body), [{ value: 'no', kind: 'main' }, { value: 'yes', kind: 'link' }]);
  const same = await t.app.inject(`/p/${t.ada.token}?a=yes`);
  assert.ok(!has(same.body, 'signup.confirm'));
  assert.deepEqual(buttons(same.body), []);
  assert.equal(stored(t, t.ada.id).signup, 'yes');
});

test('the last answer counts and the page says plainly what was answered and what comes next', async () => {
  const t = await setup();
  const steps = [['yes', 'signup.joined', 'signup.nextYes'], ['no', 'signup.notJoined', 'signup.nextNo'], ['yes', 'signup.joined', 'signup.nextYes']];
  for (const [value, textKey, nextKey] of steps) {
    t.clock.ms += 60_000;
    const res = await answer(t, t.ada, value);
    assert.equal(res.statusCode, 303, res.body);
    assert.equal(res.headers.location, `/p/${t.ada.token}`);
    const after = stored(t, t.ada.id);
    assert.equal(after.signup, value);
    assert.equal(after.signupAt, new Date(t.clock.ms).toISOString());
    const page = await t.app.inject(`/p/${t.ada.token}`);
    assert.ok(has(page.body, textKey));
    assert.ok(has(page.body, nextKey), textOf(page.body));
    assert.ok(has(page.body, 'signup.changeUntil', { date: 'vrijdag 20 november' }));
    assert.ok(!has(page.body, 'signup.question', { event: 'Gifts 2026' }), 'no longer reads as a question');
  }
  const lines = msgs(t).filter((l) => l.msg === 'signup_answer');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.participant_id, t.ada.id);
    assert.ok(!JSON.stringify(line).includes('yes') && !JSON.stringify(line).includes('"no"'), JSON.stringify(line));
  }
});

test('without an email address the yes page says the next step happens on this page', async () => {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { event, people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], invited: false, withEmail: false });
  await t.adminPost(`/admin/events/${event.id}/signup`, { deadline: DEADLINE });
  await t.adminPost(`/admin/events/${event.id}/signup/send`, { formToken: newFormToken() });
  await answer(t, people[0], 'yes');
  const page = await t.app.inject(`/p/${people[0].token}`);
  assert.ok(has(page.body, 'signup.nextYesNoEmail'), textOf(page.body));
  assert.ok(!has(page.body, 'signup.nextYes'));
});

// A slow double tap: the second tap lands where the first one was, on the
// page the answer redirected to. That page holds no answer button at all,
// so the second tap cannot store the opposite answer.
for (const first of ['yes', 'no']) {
  test(`after answering ${first} the page has no answer button, only the step to change it`, async () => {
    const t = await setup();
    const question = await t.app.inject(`/p/${t.ada.token}?a=${first}`);
    assert.equal(buttons(question.body)[0].value, first);
    const res = await answer(t, t.ada, first);
    const page = await t.app.inject(res.headers.location);
    assert.deepEqual(buttons(page.body), []);
    assert.ok(page.body.includes(changeHref(t.ada)));
    assert.ok(page.body.includes(escape(tr('nl', 'signup.change'))));
    assert.equal(stored(t, t.ada.id).signup, first);
  });
}

test('the change step shows both answers and records nothing by itself', async () => {
  const t = await setup();
  await answer(t, t.ada, 'no');
  const before = stored(t, t.ada.id);
  for (const method of ['GET', 'HEAD']) {
    const res = await t.app.inject({ method, url: `/p/${t.ada.token}?change=1` });
    assert.equal(res.statusCode, 200);
    if (method === 'GET') {
      assert.ok(has(res.body, 'signup.notJoined'));
      assert.ok(has(res.body, 'signup.changeLead'));
      assert.deepEqual(buttons(res.body), [{ value: 'yes', kind: 'main' }, { value: 'no', kind: 'secondary' }]);
      assert.ok(!res.body.includes(changeHref(t.ada)));
      assert.ok(res.body.includes(`href="/p/${t.ada.token}"`), 'a way back without changing');
    }
  }
  const after = stored(t, t.ada.id);
  assert.deepEqual([after.signup, after.signupAt], [before.signup, before.signupAt]);
  assert.equal(msgs(t).filter((l) => l.msg === 'signup_answer').length, 1);
  const switched = await answer(t, t.ada, 'yes');
  assert.equal(switched.statusCode, 303);
  assert.equal(stored(t, t.ada.id).signup, 'yes');
});

test('the change step for someone who has not answered is the plain question', async () => {
  const t = await setup();
  const res = await t.app.inject(`/p/${t.ada.token}?change=1`);
  assert.ok(has(res.body, 'signup.question', { event: 'Gifts 2026' }));
  assert.deepEqual(buttons(res.body), [{ value: 'yes', kind: 'main' }, { value: 'no', kind: 'secondary' }]);
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
  assert.ok(has(res.body, 'signup.notSaved'));
  assert.ok(has(res.body, 'signup.notJoined'));
  assert.ok(has(res.body, 'signup.askToJoin'));
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
  assert.ok(!has(res.body, 'signup.notSaved'), 'only a refused answer says it was not saved');
  assert.ok(textOf(res.body).includes('bijvoorbeeld in de les'));
  assert.deepEqual(buttons(res.body), []);
});

test('the closed page for someone who joined says how to leave', async () => {
  const t = await setup();
  await answer(t, t.ada, 'yes');
  await t.adminPost(`/admin/events/${t.eventId}/signup/close`);
  const res = await t.app.inject(`/p/${t.ada.token}`);
  assert.ok(has(res.body, 'signup.joined'));
  assert.ok(has(res.body, 'signup.askToLeave'));
  assert.ok(textOf(res.body).includes('bijvoorbeeld in de les'));
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
