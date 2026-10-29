import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCycle, validateAssignment } from '../src/draw/cycle.js';
import { openGroup } from '../src/drawing.js';
import { escape } from '../src/html.js';
import { t as tr } from '../src/i18n/index.js';
import { commitRemoveParticipant, planRemoveParticipant, sendInvitations, sendSignup } from '../src/people.js';
import { tick } from '../src/scheduler.js';
import { signupState } from '../src/signup.js';
import { newFormToken } from '../src/submit-log.js';
import { makeTestApp } from './helpers.js';

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
  assert.deepEqual(codes, ['stale-mail']);
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
