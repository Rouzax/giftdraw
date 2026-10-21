import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment } from '../src/draw/cycle.js';
import { saveWishes } from '../src/people.js';
import { wishOptions } from '../src/wishes.js';
import { makeTestApp } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const FOUR = 'Ada, ada@example.com\nBen; ben@example.com\nCor\nDirk\tdirk@example.com';

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  return { ...t, clock };
}

function idFrom(res, prefix) {
  assert.equal(res.statusCode, 303, res.body);
  const match = new RegExp(`^${prefix}/(\\d+)$`).exec(res.headers.location);
  assert.ok(match, res.headers.location);
  return Number(match[1]);
}

async function createEvent(t, name = 'Lootjes 2026') {
  return idFrom(await t.adminPost('/admin/events', { name, language: 'nl' }), '/admin/events');
}

async function createGroup(t, eventId, fields = {}) {
  const form = { name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', ...fields };
  return idFrom(await t.adminPost(`/admin/events/${eventId}/groups`, form), '/admin/groups');
}

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function hiddenPlan(body) {
  const match = /name="plan" value="([^"]*)"/.exec(body);
  assert.ok(match, 'confirmation page carries the plan');
  return unescapeHtml(match[1]);
}

async function settle(t) {
  await new Promise((resolve) => setImmediate(resolve));
  await t.drain();
  await t.drain();
}

const count = (t, sql, ...params) => t.db.prepare(sql).get(...params).n;

test('the events page lists events and offers a create form', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const res = await t.adminGet('/admin');
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`href="/admin/events/${eventId}"`));
  assert.ok(res.body.includes('Lootjes 2026'));
  assert.ok(res.body.includes('action="/admin/events"'));
  assert.equal(t.ctx.repo.getEvent(eventId).language, 'nl');
});

test('creating an event without a name is refused', async () => {
  const t = await setup();
  const res = await t.adminPost('/admin/events', { name: '  ', language: 'nl' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(t.ctx.repo.listEvents(), []);
});

test('an admin POST from another origin is refused', async () => {
  const t = await setup();
  const res = await t.adminPost('/admin/events', { name: 'X', language: 'nl' }, { origin: 'https://evil.example.com' });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(t.ctx.repo.listEvents(), []);
});

test('create an event and a group, then paste four people into a valid assignment', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId);
  const event = await t.adminGet(`/admin/events/${eventId}`);
  assert.equal(event.statusCode, 200);
  assert.ok(event.body.includes(`href="/admin/groups/${groupId}"`));

  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: FOUR });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/groups/${groupId}`);
  const people = t.ctx.repo.listParticipants(groupId);
  assert.deepEqual(people.map((p) => p.name), ['Ada', 'Ben', 'Cor', 'Dirk']);
  assert.deepEqual(people.map((p) => p.email), ['ada@example.com', 'ben@example.com', null, 'dirk@example.com']);
  assert.ok(people.every((p) => p.language === 'nl' && !p.invitedAt));
  assert.ok(validateAssignment(t.ctx.repo.getAssignment(groupId), people.map((p) => p.id)));
  assert.equal(count(t, 'SELECT count(*) AS n FROM outbox'), 0);
});

test('lines with errors show the confirmation page and add nothing until confirmed', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: `${FOUR}\nEva, eva@` });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Eva, eva@'));
  assert.ok(res.body.includes('regel 5'));
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 0);
  const confirm = await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan: hiddenPlan(res.body) });
  assert.equal(confirm.statusCode, 303);
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 4);
});

test('an email used in another group of the event needs confirmation, and a second confirm adds nothing', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const monday = await createGroup(t, eventId, { name: 'Maandag' });
  const tuesday = await createGroup(t, eventId, { name: 'Dinsdag' });
  await t.adminPost(`/admin/groups/${monday}/participants`, { text: 'Ada, ada@example.com\nBen\nCor' });

  const otherEvent = await createEvent(t, 'Ander feest');
  const elsewhere = await createGroup(t, otherEvent, { name: 'Elders' });
  const unrelated = await t.adminPost(`/admin/groups/${elsewhere}/participants`, { text: 'Ada, ada@example.com' });
  assert.equal(unrelated.statusCode, 303);

  const res = await t.adminPost(`/admin/groups/${tuesday}/participants`, {
    text: 'Ada Two, ADA@example.com\nEva, eva@example.com\nFem\nGijs',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('ada@example.com'));
  assert.ok(res.body.includes('Maandag'));
  assert.ok(!res.body.includes('Elders'));
  assert.equal(t.ctx.repo.listParticipants(tuesday).length, 0);

  const plan = hiddenPlan(res.body);
  const first = await t.adminPost(`/admin/groups/${tuesday}/participants`, { confirm: '1', plan });
  assert.equal(first.statusCode, 303);
  assert.equal(first.headers.location, `/admin/groups/${tuesday}`);
  const second = await t.adminPost(`/admin/groups/${tuesday}/participants`, { confirm: '1', plan });
  assert.equal(second.statusCode, 409);
  assert.ok(second.body.includes(`href="/admin/groups/${tuesday}"`));
  assert.equal(t.ctx.repo.listParticipants(tuesday).length, 4);
});

test('a confirmation with a tampered plan is refused', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: `${FOUR}\nEva, eva@` });
  const plan = JSON.parse(hiddenPlan(res.body));
  plan.rows[0].email = 'not an email';
  const bad = await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan: JSON.stringify(plan) });
  assert.equal(bad.statusCode, 400);
  const garbage = await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan: '{nope' });
  assert.equal(garbage.statusCode, 400);
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 0);
});

test('pasting into an open group shows which giver changes before adding', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: FOUR });
  t.ctx.repo.markInvitationsSent(groupId, t.ctx.nowIso());
  t.ctx.repo.markGroupOpened(groupId, t.ctx.nowIso());
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: 'Eva, eva@example.com' });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(hiddenPlan(res.body));
  const giver = t.ctx.repo.getParticipant(plan.rows[0].insertGiverId);
  assert.ok(res.body.includes(giver.name));
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 4);
  await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan: JSON.stringify(plan) });
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 5);
});

async function groupOfFour(t) {
  const groupId = await createGroup(t, await createEvent(t));
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: FOUR });
  return groupId;
}

test('two overlapping invite posts send one invitation per emailed participant', async () => {
  const t = await setup();
  const groupId = await groupOfFour(t);
  t.mailer.delayMs = 30;
  const [a, b] = await Promise.all([
    t.adminPost(`/admin/groups/${groupId}/invite`),
    t.adminPost(`/admin/groups/${groupId}/invite`),
  ]);
  assert.equal(a.statusCode, 303);
  assert.equal(b.statusCode, 303);
  await settle(t);
  assert.equal(count(t, "SELECT count(*) AS n FROM outbox WHERE kind = 'invite'"), 3);
  assert.deepEqual(t.mails.map((m) => m.to).sort(), ['ada@example.com', 'ben@example.com', 'dirk@example.com']);
  const people = t.ctx.repo.listParticipants(groupId);
  assert.equal(people.find((p) => p.name === 'Cor').invitedAt, null);
  assert.ok(people.filter((p) => p.email).every((p) => p.invitedAt));
  assert.ok(t.ctx.repo.getGroup(groupId).invitationsSentAt);
});

test('inviting with email off marks the group but nobody as invited', async () => {
  const t = await setup();
  const groupId = await groupOfFour(t);
  t.mailer.enabled = false;
  const res = await t.adminPost(`/admin/groups/${groupId}/invite`);
  assert.equal(res.statusCode, 303);
  assert.ok(t.ctx.repo.getGroup(groupId).invitationsSentAt);
  assert.ok(t.ctx.repo.listParticipants(groupId).every((p) => p.invitedAt === null));
  assert.equal(count(t, 'SELECT count(*) AS n FROM outbox'), 0);
  const page = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(page.body.includes('E-mail staat uit'));
});

test('the new-group form copies the previous dates but leaves a past auto-open date empty', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  t.ctx.repo.createGroup(eventId, { name: 'Oud', exchangeDate: '2026-12-11', autoOpenAt: '2026-10-25' }, t.ctx.nowIso());
  let page = await t.adminGet(`/admin/events/${eventId}`);
  assert.match(page.body, /name="exchangeDate" type="date" value="2026-12-11"/);
  assert.match(page.body, /name="autoOpenAt" type="date" value=""/);

  await createGroup(t, eventId, { name: 'Nieuw', exchangeDate: '2026-12-18', autoOpenAt: '2026-11-20' });
  page = await t.adminGet(`/admin/events/${eventId}`);
  assert.match(page.body, /name="exchangeDate" type="date" value="2026-12-18"/);
  assert.match(page.body, /name="autoOpenAt" type="date" value="2026-11-20"/);
});

test('a past auto-open date is rejected when creating or saving a group', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const refused = await t.adminPost(`/admin/events/${eventId}/groups`, {
    name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '2026-10-31',
  });
  assert.equal(refused.statusCode, 400);
  assert.equal(t.ctx.repo.listGroups(eventId).length, 0);

  const groupId = await createGroup(t, eventId, { autoOpenAt: '2026-11-01' });
  const res = await t.adminPost(`/admin/groups/${groupId}`, {
    name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '2026-10-31',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(t.ctx.repo.getGroup(groupId).autoOpenAt, '2026-11-01');

  const ok = await t.adminPost(`/admin/groups/${groupId}`, { name: 'Dinsdag', exchangeDate: '2026-12-19', autoOpenAt: '' });
  assert.equal(ok.statusCode, 303);
  const group = t.ctx.repo.getGroup(groupId);
  assert.equal(group.name, 'Dinsdag');
  assert.equal(group.exchangeDate, '2026-12-19');
  assert.equal(group.autoOpenAt, null);
});

test('the dashboard shows no email, the small group warning and each status column', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: 'Ada, ada@example.com\nBen, ben@example.com\nCor' });
  const [ada, ben, cor] = t.ctx.repo.listParticipants(groupId);
  await t.adminPost(`/admin/groups/${groupId}/invite`);
  await settle(t);
  t.ctx.repo.updateParticipant(ada.id, { visitedAt: t.ctx.nowIso() });
  saveWishes(t.ctx, ben.id, { hobbies: 'tuinieren' });
  t.ctx.repo.updateParticipant(cor.id, { printedAt: '2026-10-01T00:00:00.000Z' });

  const res = await t.adminGet(`/admin/groups/${groupId}`);
  assert.equal(res.statusCode, 200);
  const body = res.body;
  assert.ok(body.includes('geen e-mail'));
  assert.ok(body.includes('Met 3 deelnemers'));
  for (const column of ['Uitgenodigd', 'Link geopend', 'mailscanners', 'Wensen ingevuld', 'Getrokken', 'Geeft aan',
    'Laatste herinnering', 'Mailfout', 'Geprinte kaart']) {
    assert.ok(body.includes(column), column);
  }
  assert.ok(body.includes('0 van 3 getrokken'));
  assert.ok(body.includes('1 van 3 wensen ingevuld'));
  assert.ok(body.includes('1 van 3 link geopend'));
  assert.ok(body.includes('Verstuurd'));
  assert.ok(body.includes('Opnieuw printen'));
  const receiverOfAda = t.ctx.repo.getParticipant(t.ctx.repo.getParticipant(ada.id).receiverId);
  assert.ok(body.includes(receiverOfAda.name));
  assert.ok(!body.includes('E-mail staat uit'));
});

test('the dashboard shows a failed mail that is still being retried', async () => {
  const t = await setup();
  const groupId = await groupOfFour(t);
  t.mailer.fail = () => Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  await t.adminPost(`/admin/groups/${groupId}/invite`);
  await settle(t);
  const res = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(res.body.includes('Mislukt, wordt opnieuw geprobeerd'));
  assert.ok(res.body.includes('ECONNREFUSED'));
});

test('event settings save theme and wish options, and reordering keeps saved likes', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId);
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: 'Ada\nBen\nCor' });
  const [ada] = t.ctx.repo.listParticipants(groupId);

  const save = (wishText) => t.adminPost(`/admin/events/${eventId}`, {
    name: 'Lootjes 2026', language: 'nl', cleanupWeeks: '6', themeText: 'Neem iets moois mee.', wishOptions: wishText,
  });
  assert.equal((await save('Thee\nChocolade?\nSokken')).statusCode, 303);
  let event = t.ctx.repo.getEvent(eventId);
  assert.equal(event.cleanupWeeks, 6);
  assert.equal(event.themeText, 'Neem iets moois mee.');
  const socks = wishOptions(event).find((o) => !['tea', 'chocolate'].includes(o.id)).id;
  saveWishes(t.ctx, ada.id, { likes: ['tea', socks] });

  await save('Sokken\nChocolade?\nThee');
  event = t.ctx.repo.getEvent(eventId);
  assert.deepEqual(wishOptions(event).map((o) => o.id), [socks, 'chocolate', 'tea']);
  assert.deepEqual(t.ctx.repo.getParticipant(ada.id).wishes.likes, ['tea', socks]);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes('Sokken\nChocolade?\nThee'));
});

test('empty theme and wish options fall back to the defaults', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes('Dit jaar doen we een regift'));
  await t.adminPost(`/admin/events/${eventId}`, {
    name: 'Lootjes 2026', language: 'en', cleanupWeeks: '4', themeText: ' ', wishOptions: '',
  });
  const event = t.ctx.repo.getEvent(eventId);
  assert.equal(event.themeText, null);
  assert.equal(event.wishOptions, null);
  assert.equal(event.language, 'en');
});

test('deleting a group and an event needs the confirmation box', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId);
  assert.equal((await t.adminPost(`/admin/groups/${groupId}/delete`)).statusCode, 400);
  assert.ok(t.ctx.repo.getGroup(groupId));
  const res = await t.adminPost(`/admin/groups/${groupId}/delete`, { confirm: '1' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/events/${eventId}`);
  assert.equal(t.ctx.repo.getGroup(groupId), null);
  assert.equal((await t.adminPost(`/admin/events/${eventId}/delete`)).statusCode, 400);
  const gone = await t.adminPost(`/admin/events/${eventId}/delete`, { confirm: '1' });
  assert.equal(gone.statusCode, 303);
  assert.equal(gone.headers.location, '/admin');
  assert.equal(t.ctx.repo.getEvent(eventId), null);
});

test('unknown events and groups give the not-found page', async () => {
  const t = await setup();
  assert.equal((await t.adminGet('/admin/events/999')).statusCode, 404);
  assert.equal((await t.adminGet('/admin/groups/999')).statusCode, 404);
  assert.equal((await t.adminGet('/admin/groups/abc')).statusCode, 404);
  assert.equal((await t.adminPost('/admin/groups/999/invite')).statusCode, 404);
});
