import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCycle, validateAssignment } from '../src/draw/cycle.js';
import { openGroup } from '../src/drawing.js';
import { escape } from '../src/html.js';
import { formatDate, t as tr } from '../src/i18n/index.js';
import { commitRemoveParticipant, planRemoveParticipant, sendInvitations, sendSignup } from '../src/people.js';
import { tick } from '../src/scheduler.js';
import { answerSeen, signupState } from '../src/signup.js';
import { newFormToken } from '../src/submit-log.js';
import { makeTestApp, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const TZ = 'Europe/Amsterdam';
const DEADLINE = '2026-11-20';
const FOUR = 'Ada, ada@example.com\nBen, ben@example.com\nCor, cor@example.com\nDirk, dirk@example.com';
const NAMES = ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva', 'Fem', 'Gijs', 'Hans', 'Ina', 'Jan', 'Kees', 'Lot'];

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  return { ...t, clock };
}

function idFrom(res, prefix) {
  assert.equal(res.statusCode, 303, res.body);
  const match = new RegExp(`^${prefix}/(\\d+)(?:\\?done=[a-z-]+)?$`).exec(res.headers.location);
  assert.ok(match, res.headers.location);
  return Number(match[1]);
}

async function createEvent(t) {
  return idFrom(await t.adminPost('/admin/events', { name: 'Lootjes 2026', language: 'nl' }), '/admin/events');
}

async function createGroup(t, eventId, name = 'Maandag') {
  const form = { name, exchangeDate: '2026-12-18', autoOpenAt: '' };
  return idFrom(await t.adminPost(`/admin/events/${eventId}/groups`, form), '/admin/groups');
}

async function paste(t, groupId, text) {
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text });
  assert.equal(res.statusCode, 303, res.body);
}

async function turnOn(t, eventId, deadline = DEADLINE) {
  const res = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline });
  assert.equal(res.statusCode, 303, res.body);
  return res;
}

async function send(t, eventId, formToken = newFormToken()) {
  const res = await t.adminPost(`/admin/events/${eventId}/signup/send`, { formToken });
  assert.equal(res.statusCode, 303, res.body);
  return res;
}

const event = (t, id) => t.ctx.repo.getEvent(id);
const people = (t, groupId) => t.ctx.repo.listParticipants(groupId);
const state = (t, id) => signupState(event(t, id), t.ctx.now(), TZ);
const rows = (t, kind) => t.db.prepare('SELECT participant_id AS id FROM outbox WHERE kind = ? ORDER BY id').all(kind).map((r) => r.id);
const msgs = (t) => t.logs.map((line) => JSON.parse(line));

async function eventWithGroups(t, sizes) {
  const eventId = await createEvent(t);
  const groupIds = [];
  let next = 0;
  for (const [i, size] of sizes.entries()) {
    const groupId = await createGroup(t, eventId, `Groep ${i + 1}`);
    const names = NAMES.slice(next, next + size);
    next += size;
    await paste(t, groupId, names.map((n) => `${n}, ${n.toLowerCase()}@example.com`).join('\n'));
    groupIds.push(groupId);
  }
  return { eventId, groupIds };
}

test('turning sign-up on stores the deadline and clears every pairing', async () => {
  const t = await setup();
  const { eventId, groupIds } = await eventWithGroups(t, [4, 3]);
  assert.ok(people(t, groupIds[0]).every((p) => p.receiverId));
  const res = await turnOn(t, eventId);
  assert.equal(res.headers.location, `/admin/events/${eventId}?done=signup-on`);
  assert.equal(event(t, eventId).signupDeadline, DEADLINE);
  assert.equal(state(t, eventId), 'setup');
  for (const groupId of groupIds) assert.ok(people(t, groupId).every((p) => p.receiverId === null));
  const line = msgs(t).find((l) => l.msg === 'signup_enabled');
  assert.equal(line.event_id, eventId);
  const page = await t.adminGet(`/admin/events/${eventId}?done=signup-on`);
  assert.ok(page.body.includes('id="signup"'));
  assert.ok(page.body.includes(`action="/admin/events/${eventId}/signup/send"`));
  assert.ok(page.body.includes(`action="/admin/events/${eventId}/signup/off"`));
});

test('the event page offers to turn sign-up on while it is off', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes(`action="/admin/events/${eventId}/signup"`));
  assert.ok(page.body.includes('name="deadline"'));
  assert.ok(page.body.includes(escape(tr('nl', 'admin.signup.on'))));
});

test('sign-up cannot be turned on once a group sent its invitations', async () => {
  const t = await setup();
  const { eventId, groupIds } = await eventWithGroups(t, [4]);
  await t.adminPost(`/admin/groups/${groupIds[0]}/invite`);
  const res = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: DEADLINE });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes(escape(tr('nl', 'admin.signup.error.invited'))));
  assert.equal(event(t, eventId).signupDeadline, null);
  assert.ok(people(t, groupIds[0]).every((p) => p.receiverId));
});

for (const [deadline, code] of [['soon', 'signup-date'], ['2026-10-31', 'signup-past'], ['2026-12-18', 'signup-after-exchange']]) {
  test(`a deadline refused as ${code} shows as a field error and stores nothing`, async () => {
    const t = await setup();
    const { eventId, groupIds } = await eventWithGroups(t, [3]);
    const res = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes(escape(tr('nl', `admin.signup.error.${code}`))));
    assert.equal(event(t, eventId).signupDeadline, null);
    assert.ok(people(t, groupIds[0]).every((p) => p.receiverId));
  });
}

test('people pasted while sign-up is active are not paired or invited, mailed only once it was sent', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const [a, b, c] = [await createGroup(t, eventId, 'A'), await createGroup(t, eventId, 'B'), await createGroup(t, eventId, 'C')];
  await turnOn(t, eventId);

  await paste(t, a, FOUR);
  assert.ok(people(t, a).every((p) => p.receiverId === null && !p.invitedAt && !p.signupInvitedAt));
  assert.deepEqual(rows(t, 'invite'), []);
  assert.deepEqual(rows(t, 'signup'), []);

  await send(t, eventId);
  const sentToA = rows(t, 'signup');
  assert.equal(sentToA.length, 4);

  await paste(t, b, 'Eva, eva@example.com\nFem, fem@example.com\nGijs\nHans, hans@example.com');
  const inB = people(t, b);
  assert.ok(inB.every((p) => p.receiverId === null && !p.invitedAt));
  const withEmail = inB.filter((p) => p.email).map((p) => p.id);
  assert.deepEqual(rows(t, 'signup').slice(sentToA.length), withEmail);
  assert.ok(inB.every((p) => Boolean(p.signupInvitedAt) === Boolean(p.email)));
  assert.deepEqual(rows(t, 'invite'), []);

  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const before = rows(t, 'signup').length;
  await paste(t, c, 'Ina, ina@example.com\nJan, jan@example.com\nKees\nLot, lot@example.com');
  const inC = people(t, c);
  assert.ok(inC.every((p) => p.signup === 'yes' && p.receiverId === null && !p.signupInvitedAt));
  assert.equal(rows(t, 'signup').length, before);
  assert.deepEqual(rows(t, 'invite'), []);
});

test('invitations and opening are refused while sign-up is active', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  assert.deepEqual(sendInvitations(t.ctx, groupId), { refused: 'signup' });
  const res = await t.adminPost(`/admin/groups/${groupId}/invite`);
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.getGroup(groupId).invitationsSentAt, null);
  assert.deepEqual(rows(t, 'invite'), []);

  // Pairs and invitations as an open-ready group has them, so only the
  // sign-up holds the draw back.
  const ids = people(t, groupId).map((p) => p.id);
  t.ctx.repo.setAssignment(groupId, makeCycle(ids), t.ctx.nowIso());
  t.ctx.repo.markInvitationsSent(groupId, t.ctx.nowIso());
  assert.deepEqual(openGroup(t.ctx, groupId), { opened: false, reason: 'signup' });
  const open = await t.adminPost(`/admin/groups/${groupId}/open`);
  assert.equal(open.statusCode, 409);

  t.ctx.repo.updateGroup(groupId, { autoOpenAt: '2026-11-01' });
  assert.equal((await tick(t.ctx)).opened, 0);
  assert.equal(t.ctx.repo.getGroup(groupId).openedAt, null);
});

test('the group dashboard points to the sign-up instead of inviting and drawing while it is active', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  const before = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(before.body.includes(`action="/admin/groups/${groupId}/invite"`));
  await turnOn(t, eventId);
  const page = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(!page.body.includes(`action="/admin/groups/${groupId}/invite"`));
  assert.ok(!page.body.includes(`action="/admin/groups/${groupId}/open"`));
  assert.ok(!page.body.includes('id="draw"'));
  assert.ok(page.body.includes(`href="/admin/events/${eventId}#signup"`));
});

test('sending mails everyone with an address once and marks the sign-up sent', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const a = await createGroup(t, eventId, 'A');
  const b = await createGroup(t, eventId, 'B');
  await paste(t, a, FOUR);
  await paste(t, b, 'Eva, eva@example.com\nFem\nGijs, gijs@example.com');
  await turnOn(t, eventId);
  const token = newFormToken();
  const res = await send(t, eventId, token);
  assert.equal(res.headers.location, `/admin/events/${eventId}?done=signup-sent`);
  const withEmail = [...people(t, a), ...people(t, b)].filter((p) => p.email).map((p) => p.id);
  assert.deepEqual(rows(t, 'signup'), withEmail);
  assert.ok(event(t, eventId).signupSentAt);
  assert.equal(state(t, eventId), 'open');
  assert.ok([...people(t, a), ...people(t, b)].every((p) => Boolean(p.signupInvitedAt) === Boolean(p.email)));
  const line = msgs(t).find((l) => l.msg === 'signup_sent');
  assert.equal(line.queued, withEmail.length);

  const again = await send(t, eventId, token);
  assert.equal(again.headers.location, res.headers.location);
  assert.equal(rows(t, 'signup').length, withEmail.length);
  assert.deepEqual(sendSignup(t.ctx, eventId), { refused: 'open' });
  assert.equal(rows(t, 'signup').length, withEmail.length);

  await new Promise((resolve) => setImmediate(resolve));
  await t.drain();
  assert.equal(t.mails.length, withEmail.length);
  assert.ok(t.mails[0].text.includes('Lootjes 2026'));
  assert.ok(t.mails[0].text.includes('vrijdag 20 november'));
});

test('sending with mail off queues nothing and still marks the sign-up sent', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  t.mailer.enabled = false;
  await send(t, eventId);
  assert.deepEqual(rows(t, 'signup'), []);
  assert.ok(event(t, eventId).signupSentAt);
  assert.ok(people(t, groupId).every((p) => p.signupInvitedAt === null));
});

test('an open sign-up can move its deadline and be closed, and a closed one reopened', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);

  const moved = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-25' });
  assert.equal(moved.statusCode, 303);
  assert.equal(event(t, eventId).signupDeadline, '2026-11-25');
  assert.equal(state(t, eventId), 'open');

  const closed = await t.adminPost(`/admin/events/${eventId}/signup/close`);
  assert.equal(closed.headers.location, `/admin/events/${eventId}?done=signup-closed`);
  assert.equal(event(t, eventId).signupClosedAt, t.ctx.nowIso());
  assert.equal(state(t, eventId), 'closed');
  const line = msgs(t).find((l) => l.msg === 'signup_closed');
  assert.equal(line.by, 'organiser');
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes(escape(tr('nl', 'admin.signup.reopen'))));

  const past = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-10-30' });
  assert.equal(past.statusCode, 400);
  assert.ok(past.body.includes(escape(tr('nl', 'admin.signup.error.signup-past'))));
  assert.equal(state(t, eventId), 'closed');

  const reopened = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-28' });
  assert.equal(reopened.headers.location, `/admin/events/${eventId}?done=signup-reopened`);
  assert.equal(event(t, eventId).signupClosedAt, null);
  assert.equal(event(t, eventId).signupDeadline, '2026-11-28');
  assert.equal(state(t, eventId), 'open');
  assert.ok(msgs(t).some((l) => l.msg === 'signup_reopened' && l.event_id === eventId));
});

test('a sign-up that closed on its deadline reopens with a new one', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId, '2026-11-02');
  await send(t, eventId);
  t.clock.ms = Date.parse('2026-11-03T10:00:00.000Z');
  assert.equal(state(t, eventId), 'closed');
  await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-10' });
  assert.equal(state(t, eventId), 'open');
});

test('turning sign-up off before sending pairs groups of three or more again', async () => {
  const t = await setup();
  const { eventId, groupIds: [big, small] } = await eventWithGroups(t, [4, 2]);
  await turnOn(t, eventId);
  const res = await t.adminPost(`/admin/events/${eventId}/signup/off`);
  assert.equal(res.headers.location, `/admin/events/${eventId}?done=signup-off`);
  assert.equal(event(t, eventId).signupDeadline, null);
  assert.equal(state(t, eventId), 'off');
  const ids = people(t, big).map((p) => p.id);
  assert.ok(validateAssignment(t.ctx.repo.getAssignment(big), ids));
  assert.equal(t.ctx.repo.getAssignment(small).size, 0);
  assert.ok(msgs(t).some((l) => l.msg === 'signup_disabled' && l.event_id === eventId));
});

test('sign-up cannot be turned off once it was sent', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const res = await t.adminPost(`/admin/events/${eventId}/signup/off`);
  assert.equal(res.statusCode, 409);
  assert.equal(event(t, eventId).signupDeadline, DEADLINE);
});

test('sign-up log lines carry ids and counts, never names or addresses', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  await t.adminPost(`/admin/events/${eventId}/signup/off`);
  await turnOn(t, eventId);
  await send(t, eventId);
  await paste(t, groupId, 'Zoe, zoe@example.com');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-28' });
  const lines = t.logs.filter((line) => /"msg":"signup_/.test(line));
  assert.ok(lines.length >= 6, lines.join('\n'));
  for (const line of lines) {
    for (const name of [...NAMES, 'Zoe']) assert.ok(!line.includes(name), line);
    assert.ok(!line.includes('@'), line);
  }
});

test('a sign-up mail still queued when sign-up closes is not sent', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  t.ctx.repo.updateEvent(eventId, { signupSentAt: t.ctx.nowIso() }, t.ctx.nowIso());
  for (const p of t.ctx.repo.listEventParticipants(eventId)) t.ctx.repo.enqueue(p.id, 'signup', t.ctx.nowIso());
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  await t.drain();
  assert.equal(t.mails.length, 0);
  const codes = t.db.prepare("SELECT DISTINCT error_code AS code FROM outbox WHERE kind = 'signup'").all().map((r) => r.code);
  assert.deepEqual(codes, ['stale-signup']);
});

for (const closed of [false, true]) {
  test(`removing someone while sign-up is ${closed ? 'closed' : 'in setup'} pairs nobody`, async () => {
    const t = await setup();
    const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
    await turnOn(t, eventId);
    if (closed) {
      await send(t, eventId);
      await t.adminPost(`/admin/events/${eventId}/signup/close`);
    }
    const [gone] = people(t, groupId);
    const plan = planRemoveParticipant(t.ctx, gone.id);
    assert.equal(plan.map, null);
    assert.deepEqual(plan.changedGivers, []);
    const preview = await t.adminGet(`/admin/participants/${gone.id}/remove`);
    assert.ok(preview.body.includes(escape(tr('nl', 'admin.remove.signup'))));
    const res = await t.adminPost(`/admin/participants/${gone.id}/remove`, {
      formToken: newFormToken(), plan: JSON.stringify({ version: plan.version, map: null }),
    });
    assert.equal(res.statusCode, 303, res.body);
    assert.ok(people(t, groupId).every((p) => p.receiverId === null));
  });
}

test('a removal plan with pairs is refused while sign-up is active', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  const [gone, ...rest] = people(t, groupId);
  const { version } = planRemoveParticipant(t.ctx, gone.id);
  const ids = rest.map((p) => p.id);
  const map = [...makeCycle(ids)];
  assert.deepEqual(commitRemoveParticipant(t.ctx, gone.id, { version, map }), { error: 'invalid' });
  assert.ok(people(t, groupId).every((p) => p.receiverId === null));
});

test('a second press on turning sign-up off leads back to the event page', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await t.adminPost(`/admin/events/${eventId}/signup/off`);
  const again = await t.adminPost(`/admin/events/${eventId}/signup/off`);
  assert.equal(again.statusCode, 303);
  assert.equal(again.headers.location, `/admin/events/${eventId}`);
});

test('while sign-up is active a group cannot exchange on or before the closing date', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  const message = escape(tr('nl', 'admin.group.error.exchangeBeforeSignup'));
  const created = await t.adminPost(`/admin/events/${eventId}/groups`, { name: 'Dinsdag', exchangeDate: DEADLINE, autoOpenAt: '' });
  assert.equal(created.statusCode, 400);
  assert.ok(created.body.includes(message));
  assert.equal(t.ctx.repo.listGroups(eventId).length, 1);
  const edited = await t.adminPost(`/admin/groups/${groupId}`, { name: 'Maandag', exchangeDate: '2026-11-19', autoOpenAt: '' });
  assert.equal(edited.statusCode, 400);
  assert.ok(edited.body.includes(message));
  assert.equal(t.ctx.repo.getGroup(groupId).exchangeDate, '2026-12-18');
  const later = await t.adminPost(`/admin/events/${eventId}/groups`, { name: 'Woensdag', exchangeDate: '2026-11-21', autoOpenAt: '' });
  assert.equal(later.statusCode, 303);
});

const answerAs = (t, p, value) => t.post(`/p/${p.token}/signup`, { answer: value });

// The organiser's set-answer form as the page renders it: with the answer it
// was rendered from.
const setAnswer = (t, p, answer, back = 'event') => {
  const now = t.ctx.repo.getParticipant(p.id);
  return t.adminPost(`/admin/participants/${p.id}/signup`, { answer, back, seen: answerSeen(now) });
};
const rowOf = (body, p) => body.split('<tr>').find((row) => row.includes(`href="/admin/participants/${p.id}"`))?.split('</tr>')[0] ?? '';
const words = (lang, key, vars) => escape(tr(lang, key, vars));

// Group A: four yes, one no, one without an answer. Group B: three yes.
async function answeredAndClosed(t) {
  const { eventId, groupIds: [a, b] } = await eventWithGroups(t, [6, 3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada, ben, cor, dirk, eva, fem] = people(t, a);
  for (const p of [ada, ben, cor, dirk, ...people(t, b)]) assert.equal((await answerAs(t, p, 'yes')).statusCode, 303);
  assert.equal((await answerAs(t, eva, 'no')).statusCode, 303);
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  return { eventId, a, b, eva, fem };
}

test('the sign-up panel lists each group with its answers and a button to change each', async () => {
  const t = await setup();
  const { eventId, groupIds: [a] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada, ben] = people(t, a);
  await answerAs(t, ada, 'yes');
  await answerAs(t, ben, 'no');
  const open = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(open.body.includes(escape(tr('nl', 'admin.signup.counts', { yes: 1, no: 1, none: 2 }))));
  assert.ok(open.body.includes(escape(tr('nl', 'admin.warning.below-minimum'))));
  for (const p of people(t, a)) assert.ok(open.body.includes(`action="/admin/participants/${p.id}/signup"`));
  assert.ok(open.body.includes('name="back" value="event"'));

  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const closed = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(closed.body.includes(escape(`${tr('nl', 'admin.signup.joinsOne', { count: 1 })}, ${tr('nl', 'admin.signup.declines', { count: 3 })}`)));
  assert.ok(closed.body.includes(`href="/admin/events/${eventId}/signup/finish"`));
});

test('the closed sign-up panel uses the singular for one joiner and one non-joiner', async () => {
  const t = await setup();
  const { eventId, groupIds: [a] } = await eventWithGroups(t, [2]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada, ben] = people(t, a);
  await answerAs(t, ada, 'yes');
  await answerAs(t, ben, 'no');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const closed = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(closed.body.includes('1 doet mee, 1 doet niet mee'));
});

test('the organiser sets someone who did not answer to yes after closing', async () => {
  const t = await setup();
  const { eventId, fem } = await answeredAndClosed(t);
  const res = await setAnswer(t, fem, 'yes');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/events/${eventId}#signup`);
  assert.equal(t.ctx.repo.getParticipant(fem.id).signup, 'yes');
  assert.ok(t.ctx.repo.getParticipant(fem.id).signupAt);
  const line = msgs(t).find((l) => l.msg === 'signup_set');
  assert.equal(line.participant_id, fem.id);

  const page = await t.adminGet(`/admin/participants/${fem.id}`);
  assert.ok(page.body.includes(`action="/admin/participants/${fem.id}/signup"`));
  assert.ok(page.body.includes('name="back" value="person"'));
  const back = await setAnswer(t, fem, 'no', 'person');
  assert.equal(back.headers.location, `/admin/participants/${fem.id}`);
  assert.equal(t.ctx.repo.getParticipant(fem.id).signup, 'no');
  const elsewhere = await setAnswer(t, fem, 'yes', 'https://example.org');
  assert.equal(elsewhere.headers.location, `/admin/events/${eventId}#signup`);
  const bad = await t.adminPost(`/admin/participants/${fem.id}/signup`, { answer: 'maybe' });
  assert.equal(bad.statusCode, 400);
});

test('the organiser cannot set an answer when sign-up is off', async () => {
  const t = await setup();
  const { groupIds: [a] } = await eventWithGroups(t, [3]);
  const [ada] = people(t, a);
  const res = await t.adminPost(`/admin/participants/${ada.id}/signup`, { answer: 'yes' });
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, null);
  const page = await t.adminGet(`/admin/participants/${ada.id}`);
  assert.ok(!page.body.includes(`action="/admin/participants/${ada.id}/signup"`));
});

test('starting the draw removes who does not join, pairs the rest and invites them', async () => {
  const t = await setup();
  const { eventId, a, b, eva, fem } = await answeredAndClosed(t);
  const below = escape(tr('nl', 'admin.warning.below-minimum'));

  const preview = await t.adminGet(`/admin/events/${eventId}/signup/finish`);
  assert.equal(preview.statusCode, 200);
  const removed = preview.body.split(escape(tr('nl', 'admin.signup.finish.leaving')))[1];
  assert.ok(removed.includes('Eva') && removed.includes('Fem'));
  assert.ok(!preview.body.includes(below));
  assert.ok(preview.body.includes(`action="/admin/events/${eventId}/signup/finish"`));
  assert.ok(preview.body.includes('name="confirm"'));

  const unconfirmed = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken() });
  assert.equal(unconfirmed.statusCode, 200);
  assert.ok(unconfirmed.body.includes('name="confirm"'));
  assert.equal(people(t, a).length, 6);
  assert.equal(event(t, eventId).signupDoneAt, null);

  const formToken = newFormToken();
  const res = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken, confirm: '1' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(res.headers.location, `/admin/events/${eventId}?done=signup-done`);

  const inA = people(t, a);
  assert.equal(inA.length, 4);
  assert.ok(validateAssignment(t.ctx.repo.getAssignment(a), inA.map((p) => p.id)));
  const inB = people(t, b);
  assert.equal(inB.length, 3);
  assert.ok(validateAssignment(t.ctx.repo.getAssignment(b), inB.map((p) => p.id)));
  for (const gone of [eva, fem]) assert.equal((await t.app.inject(`/p/${gone.token}`)).statusCode, 404);
  const remaining = [...inA, ...inB];
  assert.deepEqual(rows(t, 'invite'), remaining.map((p) => p.id));
  assert.ok(event(t, eventId).signupDoneAt);
  assert.equal(state(t, eventId), 'done');
  const line = msgs(t).find((l) => l.msg === 'signup_finished');
  assert.deepEqual([line.joined, line.removed, line.groups_unpaired], [7, 2, 0]);

  const again = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken, confirm: '1' });
  assert.equal(again.headers.location, res.headers.location);
  assert.equal(rows(t, 'invite').length, remaining.length);
  assert.equal(msgs(t).filter((l) => l.msg === 'signup_finished').length, 1);

  const page = await t.adminGet(`/admin/events/${eventId}?done=signup-done`);
  assert.ok(page.body.includes(escape(tr('nl', 'admin.person.done.signup-done'))));
  assert.equal(openGroup(t.ctx, a).opened, true);
});

test('starting the draw is refused while sign-up is still open', async () => {
  const t = await setup();
  const { eventId, groupIds: [a] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const res = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  assert.equal(res.statusCode, 409);
  assert.equal(people(t, a).length, 3);
  assert.equal(event(t, eventId).signupDoneAt, null);
  assert.equal((await t.adminGet(`/admin/events/${eventId}/signup/finish`)).statusCode, 409);
});

test('sending after the closing date passed is refused and queues nothing', async () => {
  const t = await setup();
  const { eventId } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId, '2026-11-02');
  t.clock.ms = Date.parse('2026-11-02T23:00:00.000Z');
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes(escape(tr('nl', 'admin.signup.setupPassed'))));
  assert.ok(!page.body.includes(`action="/admin/events/${eventId}/signup/send"`));
  assert.deepEqual(sendSignup(t.ctx, eventId), { refused: 'passed' });
  const res = await t.adminPost(`/admin/events/${eventId}/signup/send`, { formToken: newFormToken() });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes(escape(tr('nl', 'admin.signup.error.signup-passed'))));
  assert.deepEqual(rows(t, 'signup'), []);
  assert.equal(event(t, eventId).signupSentAt, null);
  assert.equal(state(t, eventId), 'setup');
  await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-10' });
  await send(t, eventId);
  assert.equal(rows(t, 'signup').length, 3);
});

test('sign-up cannot be turned on once anyone in the event was invited', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  const [ada] = people(t, groupId);
  assert.equal((await t.adminPost(`/admin/participants/${ada.id}/resend-invite`)).statusCode, 303);
  assert.ok(t.ctx.repo.getParticipant(ada.id).invitedAt);
  assert.equal(t.ctx.repo.getGroup(groupId).invitationsSentAt, null);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(!page.body.includes('id="signup"'));
  const res = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: DEADLINE });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes(escape(tr('nl', 'admin.signup.error.invited'))));
  assert.equal(event(t, eventId).signupDeadline, null);
});

test('the event page leaves the sign-up panel out once it can no longer be turned on', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await t.adminPost(`/admin/groups/${groupId}/invite`);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(!page.body.includes('id="signup"'));
  assert.ok(!page.body.includes(escape(tr('nl', 'admin.signup.intro'))));
});

test('a closing date on or after a group\'s automatic opening date is refused', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  t.ctx.repo.updateGroup(groupId, { autoOpenAt: '2026-11-20' });
  const message = escape(tr('nl', 'admin.signup.error.signup-after-auto-open'));
  for (const deadline of ['2026-11-20', '2026-11-25']) {
    const res = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes(message));
  }
  assert.equal(event(t, eventId).signupDeadline, null);
  await turnOn(t, eventId, '2026-11-19');
  const moved = await t.adminPost(`/admin/events/${eventId}/signup`, { deadline: '2026-11-21' });
  assert.equal(moved.statusCode, 400);
  assert.ok(moved.body.includes(message));
  assert.equal(event(t, eventId).signupDeadline, '2026-11-19');
});

test('while sign-up is active an automatic opening date on or before the closing date is refused', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  const message = escape(tr('nl', 'admin.group.error.autoOpenBeforeSignup'));
  const form = { name: 'Maandag', exchangeDate: '2026-12-18' };
  for (const autoOpenAt of [DEADLINE, '2026-11-10']) {
    const res = await t.adminPost(`/admin/groups/${groupId}`, { ...form, autoOpenAt });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes(message));
  }
  const created = await t.adminPost(`/admin/events/${eventId}/groups`, { ...form, name: 'Dinsdag', autoOpenAt: DEADLINE });
  assert.equal(created.statusCode, 400);
  assert.ok(created.body.includes(message));
  assert.equal(t.ctx.repo.getGroup(groupId).autoOpenAt, null);
  const later = await t.adminPost(`/admin/groups/${groupId}`, { ...form, autoOpenAt: '2026-11-21' });
  assert.equal(later.statusCode, 303);
});

test('the finish page warns for a group whose automatic opening date has come', async () => {
  const t = await setup();
  const { eventId, a, b } = await answeredAndClosed(t);
  t.ctx.repo.updateGroup(a, { autoOpenAt: '2026-11-21' });
  t.ctx.repo.updateGroup(b, { autoOpenAt: '2026-11-25' });
  t.clock.ms = Date.parse('2026-11-21T07:00:00.000Z');
  const page = await t.adminGet(`/admin/events/${eventId}/signup/finish`);
  const warning = escape(tr('nl', 'admin.signup.finish.opensAtOnce'));
  assert.equal(page.body.split(warning).length - 1, 1);
  const [groupA, groupB] = page.body.split('<section class="panel">').slice(1);
  assert.ok(groupA.includes(warning));
  assert.ok(!groupB.includes(warning));
});

test('the person page offers no invitation or reminder while sign-up is active, and refuses them', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  const [ada] = people(t, groupId);
  const page = await t.adminGet(`/admin/participants/${ada.id}`);
  assert.ok(!page.body.includes(`action="/admin/participants/${ada.id}/resend-invite"`));
  assert.ok(!page.body.includes(`action="/admin/participants/${ada.id}/remind"`));
  assert.ok(!page.body.includes(`action="/admin/participants/${ada.id}/resend-signup"`));
  for (const path of ['resend-invite', 'remind']) {
    const res = await t.adminPost(`/admin/participants/${ada.id}/${path}`);
    assert.equal(res.headers.location, `/admin/participants/${ada.id}?done=signup-active`);
  }
  assert.equal(t.ctx.repo.getParticipant(ada.id).invitedAt, null);
  assert.deepEqual(rows(t, 'invite'), []);
  const notice = await t.adminGet(`/admin/participants/${ada.id}?done=signup-active`);
  assert.ok(notice.body.includes(escape(tr('nl', 'admin.person.done.signup-active'))));
});

test('while sign-up is open the person page resends the sign-up mail to someone who has not answered', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  await send(t, eventId);
  await paste(t, groupId, 'Zoe');
  const [ada, ben] = people(t, groupId);
  const zoe = people(t, groupId).find((p) => p.name === 'Zoe');
  await answerAs(t, ben, 'no');
  const page = await t.adminGet(`/admin/participants/${ada.id}`);
  assert.ok(page.body.includes(`action="/admin/participants/${ada.id}/resend-signup"`));
  assert.ok(page.body.includes(escape(tr('nl', 'admin.person.mail.resendSignup'))));
  assert.ok(!page.body.includes(`action="/admin/participants/${ada.id}/resend-invite"`));
  for (const who of [ben, zoe]) {
    const other = await t.adminGet(`/admin/participants/${who.id}`);
    assert.ok(!other.body.includes(`action="/admin/participants/${who.id}/resend-signup"`), who.name);
  }

  const before = rows(t, 'signup').length;
  const res = await t.adminPost(`/admin/participants/${ada.id}/resend-signup`);
  assert.equal(res.headers.location, `/admin/participants/${ada.id}?done=signup-queued`);
  const added = t.db.prepare("SELECT participant_id AS id, manual FROM outbox WHERE kind = 'signup' ORDER BY outbox.id").all().slice(before);
  assert.deepEqual(added.map((r) => [r.id, r.manual]), [[ada.id, 1]]);
  const answered = await t.adminPost(`/admin/participants/${ben.id}/resend-signup`);
  assert.equal(answered.headers.location, `/admin/participants/${ben.id}?done=signup-answered`);
  const noEmail = await t.adminPost(`/admin/participants/${zoe.id}/resend-signup`);
  assert.equal(noEmail.headers.location, `/admin/participants/${zoe.id}?done=no-email`);
  assert.equal(rows(t, 'signup').length, before + 1);

  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const closed = await t.adminPost(`/admin/participants/${ada.id}/resend-signup`);
  assert.equal(closed.headers.location, `/admin/participants/${ada.id}?done=signup-not-open`);
});

test('resending the sign-up mail marks someone never asked as asked', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada] = people(t, groupId);
  t.ctx.repo.updateParticipant(ada.id, { signupInvitedAt: null });
  await t.adminPost(`/admin/participants/${ada.id}/resend-signup`);
  assert.equal(t.ctx.repo.getParticipant(ada.id).signupInvitedAt, t.ctx.nowIso());
});

test('someone who already has an answer when sign-up is sent is never mailed about it', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  const [ada, ben] = people(t, groupId);
  await setAnswer(t, ada, 'no');
  await setAnswer(t, ben, 'yes');
  await send(t, eventId);
  for (const p of [ada, ben]) assert.equal(t.ctx.repo.getParticipant(p.id).signupInvitedAt, null);
  assert.equal(rows(t, 'signup').length, 2);
  while (t.clock.ms < Date.parse('2026-11-20T23:00:00.000Z')) {
    t.clock.ms += 3_600_000;
    await tick(t.ctx);
  }
  const mailed = t.db.prepare('SELECT DISTINCT participant_id AS id FROM outbox').all().map((r) => r.id);
  assert.ok(!mailed.includes(ada.id) && !mailed.includes(ben.id), mailed.join());
  assert.ok(rows(t, 'remind-signup').length > 0);
});

test('a group whose invitations fail does not stop the others, and the finish is logged', async () => {
  const t = await setup();
  const { eventId, a, b } = await answeredAndClosed(t);
  const mark = t.ctx.repo.markInvitationsSent;
  t.ctx.repo.markInvitationsSent = (groupId, now) => {
    if (groupId === a) throw new Error('boom');
    return mark(groupId, now);
  };
  let checkpoints = 0;
  const checkpoint = t.ctx.repo.checkpoint;
  t.ctx.repo.checkpoint = () => {
    checkpoints += 1;
    return checkpoint();
  };
  const res = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(state(t, eventId), 'done');
  assert.ok(t.ctx.repo.getGroup(b).invitationsSentAt);
  assert.equal(t.ctx.repo.getGroup(a).invitationsSentAt, null);
  assert.deepEqual(rows(t, 'invite'), people(t, b).map((p) => p.id));
  const failed = msgs(t).filter((l) => l.msg === 'invitations_failed');
  assert.deepEqual(failed.map((l) => l.group_id), [a]);
  assert.equal(msgs(t).filter((l) => l.msg === 'signup_finished').length, 1);
  assert.equal(checkpoints, 1);
});

test('an answer refused from the person page shows the person page', async () => {
  const t = await setup();
  const { groupIds: [a] } = await eventWithGroups(t, [3]);
  const [ada] = people(t, a);
  const res = await t.adminPost(`/admin/participants/${ada.id}/signup`, { answer: 'yes', back: 'person' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes(`<h1>${ada.name}</h1>`));
  assert.ok(res.body.includes(escape(tr('nl', 'admin.signup.error.state'))));
});

test('the organiser cannot set an answer once sign-up is done', async () => {
  const t = await setup();
  const { eventId, a } = await answeredAndClosed(t);
  await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  const [ada] = people(t, a);
  const res = await setAnswer(t, ada, 'no');
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, 'yes');
});

test('the group dashboard drops the waiting-for-invitations line while sign-up is active', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  t.ctx.repo.updateGroup(groupId, { autoOpenAt: '2026-12-01' });
  const line = escape(tr('nl', 'admin.warning.awaiting-invitations'));
  assert.ok((await t.adminGet(`/admin/groups/${groupId}`)).body.includes(line));
  await turnOn(t, eventId);
  assert.ok(!(await t.adminGet(`/admin/groups/${groupId}`)).body.includes(line));
});


test('the class table shows each sign-up answer and the sign-up mail while sign-up runs', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [4]);
  await turnOn(t, eventId);
  const [ada, ben, cor, dirk] = people(t, groupId);
  await setAnswer(t, dirk, 'no');

  const setupPage = (await t.adminGet(`/admin/groups/${groupId}`)).body;
  assert.ok(setupPage.includes(`<th scope="col">${words('nl', 'admin.col.signup')}</th>`));
  assert.ok(setupPage.includes(`<th scope="col">${words('nl', 'admin.col.signupMail')}</th>`));
  assert.ok(!setupPage.includes(`<th scope="col">${words('nl', 'admin.col.invited')}</th>`));
  assert.ok(textOf(rowOf(setupPage, ada)).includes(tr('nl', 'admin.status.notYet')));
  assert.ok(rowOf(setupPage, dirk).includes(`data-label="${words('nl', 'admin.col.signupMail')}"`));
  assert.ok(textOf(rowOf(setupPage, dirk)).includes(tr('nl', 'admin.signupMail.notNeeded')));

  await send(t, eventId);
  await t.drain();
  await answerAs(t, ada, 'yes');
  await answerAs(t, ben, 'no');
  const open = (await t.adminGet(`/admin/groups/${groupId}`)).body;
  const cell = (p) => textOf(rowOf(open, p).split(`data-label="${words('nl', 'admin.col.signup')}">`)[1].split('</td>')[0]);
  assert.equal(cell(ada).trim(), tr('nl', 'admin.signup.answer.yes'));
  assert.equal(cell(ben).trim(), tr('nl', 'admin.signup.answer.no'));
  assert.equal(cell(cor).trim(), tr('nl', 'admin.signup.answer.none'));
  for (const p of [ada, ben, cor]) assert.ok(textOf(rowOf(open, p)).includes(tr('nl', 'admin.invite.sent')), p.name);
  assert.ok(open.includes(words('nl', 'admin.summary.signupMailed', { count: 3, total: 4 })));
  assert.ok(open.includes(words('nl', 'admin.summary.signup', { counts: tr('nl', 'admin.signup.counts', { yes: 1, no: 2, none: 1 }) })));
  assert.ok(!open.includes(words('nl', 'admin.summary.invited', { count: 0, total: 4 })));

  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const closed = (await t.adminGet(`/admin/groups/${groupId}`)).body;
  assert.ok(textOf(rowOf(closed, cor)).includes(tr('nl', 'admin.signup.answer.noneClosed')));
});

test('after the draw starts the class table is the one without sign-up', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  for (const p of people(t, groupId)) await answerAs(t, p, 'yes');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  const page = (await t.adminGet(`/admin/groups/${groupId}`)).body;
  assert.ok(!page.includes(words('nl', 'admin.col.signup')));
  assert.ok(!page.includes(words('nl', 'admin.col.signupMail')));
  assert.ok(page.includes(`<th scope="col">${words('nl', 'admin.col.invited')}</th>`));
  assert.ok(page.includes(words('nl', 'admin.summary.invited', { count: 0, total: 3 })));
});

test('with mail off the class table shows the answers but no sign-up mail column', async () => {
  const t = await setup();
  const { eventId, groupIds: [groupId] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  t.mailer.enabled = false;
  await send(t, eventId);
  const [ada] = people(t, groupId);
  await answerAs(t, ada, 'yes');
  const page = (await t.adminGet(`/admin/groups/${groupId}`)).body;
  assert.ok(page.includes(`<th scope="col">${words('nl', 'admin.col.signup')}</th>`));
  assert.ok(!page.includes(words('nl', 'admin.col.signupMail')));
  assert.ok(!page.includes(words('nl', 'admin.col.invited')));
  assert.ok(!page.includes(words('nl', 'admin.summary.signupMailed', { count: 0, total: 3 })));
  assert.ok(page.includes(words('nl', 'admin.summary.signup', { counts: tr('nl', 'admin.signup.counts', { yes: 1, no: 0, none: 2 }) })));
});

test('the draw cannot start while a group has one or two people taking part', async () => {
  const t = await setup();
  const { eventId, groupIds: [two, five] } = await eventWithGroups(t, [4, 5]);
  await turnOn(t, eventId);
  await send(t, eventId);
  await t.drain();
  const [ada, ben] = people(t, two);
  for (const p of [ada, ben, ...people(t, five)]) await answerAs(t, p, 'yes');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const before = t.db.prepare('SELECT count(*) AS n FROM outbox').get().n;
  const sentBefore = t.mails.length;
  const fix = words('nl', 'admin.signup.finish.tooSmallFix');

  const preview = await t.adminGet(`/admin/events/${eventId}/signup/finish`);
  assert.equal(preview.statusCode, 200);
  assert.ok(preview.body.includes(fix));
  assert.ok(preview.body.includes(words('nl', 'admin.signup.finish.tooSmallGroup', { group: 'Groep 1', count: 2 })));
  assert.ok(!preview.body.includes(words('nl', 'admin.signup.finish.tooSmallGroup', { group: 'Groep 2', count: 5 })));
  assert.ok(!preview.body.includes('name="confirm"'));

  const res = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes(fix));
  assert.ok(!res.body.includes('name="confirm"'));
  assert.equal(people(t, two).length, 4);
  assert.equal(people(t, five).length, 5);
  assert.equal(event(t, eventId).signupDoneAt, null);
  assert.equal(state(t, eventId), 'closed');
  await t.drain();
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM outbox').get().n, before);
  assert.equal(t.mails.length, sentBefore);
  assert.ok(people(t, five).every((p) => p.receiverId === null && !p.invitedAt));
  const line = msgs(t).find((l) => l.msg === 'signup_refused' && l.reason === 'too-small');
  assert.equal(line.event_id, eventId);
  assert.equal(line.groups, 1);
  assert.equal(msgs(t).filter((l) => l.msg === 'signup_finished').length, 0);
});

test('a group where nobody takes part is named on the confirmation and left empty', async () => {
  const t = await setup();
  const { eventId, groupIds: [none, three] } = await eventWithGroups(t, [2, 3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  for (const p of people(t, three)) await answerAs(t, p, 'yes');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const preview = await t.adminGet(`/admin/events/${eventId}/signup/finish`);
  assert.equal(preview.statusCode, 200);
  assert.ok(preview.body.includes(words('nl', 'admin.signup.finish.empty', { group: 'Groep 1' })));
  assert.ok(!preview.body.includes(words('nl', 'admin.signup.finish.tooSmallFix')));
  assert.ok(preview.body.includes('name="confirm"'));
  const res = await t.adminPost(`/admin/events/${eventId}/signup/finish`, { formToken: newFormToken(), confirm: '1' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(people(t, none).length, 0);
  assert.equal(people(t, three).length, 3);
  assert.ok(people(t, three).every((p) => p.receiverId));
});

test('a closed sign-up names on the event and class pages who did not answer and has no address', async () => {
  const t = await setup();
  const { eventId, groupIds: [a, b] } = await eventWithGroups(t, [3, 3]);
  await paste(t, a, 'Ida');
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada] = people(t, a);
  await answerAs(t, ada, 'yes');
  t.clock.ms = Date.parse('2026-11-05T10:00:00.000Z');
  await t.adminPost(`/admin/events/${eventId}/signup/close`);
  const date = formatDate('nl', '2026-11-05', TZ);

  const eventPage = (await t.adminGet(`/admin/events/${eventId}`)).body;
  assert.ok(eventPage.includes(words('nl', 'admin.signup.closedOn', { date })));
  assert.ok(eventPage.includes(words('nl', 'admin.signup.noAnswer', { count: 6 })));
  assert.ok(eventPage.includes(words('nl', 'admin.signup.noEmailNoAnswer')));
  const list = eventPage.split(words('nl', 'admin.signup.noEmailNoAnswer'))[1].split('</ul>')[0];
  assert.ok(list.includes('Ida'));
  assert.ok(!list.includes('Ben'));

  const classA = (await t.adminGet(`/admin/groups/${a}`)).body;
  assert.ok(classA.includes(words('nl', 'admin.signup.closedOn', { date })));
  assert.ok(classA.includes(words('nl', 'admin.signup.noAnswer', { count: 3 })));
  assert.ok(classA.split(words('nl', 'admin.signup.noEmailNoAnswer'))[1].split('</ul>')[0].includes('Ida'));
  const classB = (await t.adminGet(`/admin/groups/${b}`)).body;
  assert.ok(classB.includes(words('nl', 'admin.signup.noAnswer', { count: 3 })));
  assert.ok(!classB.includes(words('nl', 'admin.signup.noEmailNoAnswer')));

  const finish = (await t.adminGet(`/admin/events/${eventId}/signup/finish`)).body;
  assert.ok(finish.split(words('nl', 'admin.signup.finish.noEmail'))[1].split('</ul>')[0].includes('Ida'));

  const open = await setup();
  const opened = await eventWithGroups(open, [3]);
  await turnOn(open, opened.eventId);
  await send(open, opened.eventId);
  const openPage = (await open.adminGet(`/admin/groups/${opened.groupIds[0]}`)).body;
  assert.ok(!openPage.includes(words('nl', 'admin.signup.noAnswer', { count: 3 })));
});

test('a sign-up closed by its deadline shows the closing date', async () => {
  const t = await setup();
  const { eventId, groupIds: [a] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  t.clock.ms = Date.parse('2026-11-25T10:00:00.000Z');
  assert.equal(state(t, eventId), 'closed');
  const date = formatDate('nl', DEADLINE, TZ);
  assert.ok((await t.adminGet(`/admin/groups/${a}`)).body.includes(words('nl', 'admin.signup.closedOn', { date })));
  assert.ok((await t.adminGet(`/admin/events/${eventId}`)).body.includes(words('nl', 'admin.signup.noAnswer', { count: 3 })));
});

test('an organiser answer from a page older than the stored answer is refused and changes nothing', async () => {
  const t = await setup();
  const { eventId, groupIds: [a] } = await eventWithGroups(t, [3]);
  await turnOn(t, eventId);
  await send(t, eventId);
  const [ada] = people(t, a);
  const page = (await t.adminGet(`/admin/events/${eventId}`)).body;
  const form = page.split(`action="/admin/participants/${ada.id}/signup"`)[1].split('</form>')[0];
  const seen = /name="seen" value="([^"]*)"/.exec(form)?.[1];
  assert.equal(seen, answerSeen(t.ctx.repo.getParticipant(ada.id)));
  t.clock.ms += 60_000;
  await answerAs(t, ada, 'no');

  const res = await t.adminPost(`/admin/participants/${ada.id}/signup`, { answer: 'yes', back: 'event', seen });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes(words('nl', 'admin.signup.error.changed', { name: 'Ada' })));
  assert.ok(res.body.includes('id="signup"'));
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, 'no');
  const line = msgs(t).find((l) => l.msg === 'signup_refused' && l.reason === 'changed');
  assert.equal(line.participant_id, ada.id);

  const person = await t.adminPost(`/admin/participants/${ada.id}/signup`, { answer: 'yes', back: 'person', seen });
  assert.equal(person.statusCode, 409);
  assert.ok(person.body.includes(`<h1>${ada.name}</h1>`));
  assert.ok(person.body.includes(words('nl', 'admin.signup.error.changed', { name: 'Ada' })));
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, 'no');

  const missing = await t.adminPost(`/admin/participants/${ada.id}/signup`, { answer: 'yes', back: 'event' });
  assert.equal(missing.statusCode, 409);
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, 'no');

  assert.equal((await setAnswer(t, ada, 'yes')).statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(ada.id).signup, 'yes');
});
