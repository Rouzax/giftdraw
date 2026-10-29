import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment } from '../src/draw/cycle.js';
import { saveWishes } from '../src/people.js';
import { wishOptions } from '../src/wishes.js';
import { aboutBody, makeTestApp } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const FOUR = 'Ada, ada@example.com\nBen; ben@example.com\nCor\nDirk\tdirk@example.com';

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
  assert.equal(res.headers.location, `/admin/groups/${groupId}?done=added`);
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
  assert.equal(first.headers.location, `/admin/groups/${tuesday}?done=added`);
  // Without a form token on record, a repeat can only be told apart as stale.
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
  saveWishes(t.ctx, ben.id, aboutBody({ q_hobbies: 'tuinieren' }));
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
  saveWishes(t.ctx, ada.id, aboutBody({ q_likes: ['tea', socks] }));

  await save('Sokken\nChocolade?\nThee');
  event = t.ctx.repo.getEvent(eventId);
  assert.deepEqual(wishOptions(event).map((o) => o.id), [socks, 'chocolate', 'tea']);
  assert.deepEqual(t.ctx.repo.getParticipant(ada.id).wishes.answers.likes.ticked, ['tea', socks]);
  const page = await t.adminGet(`/admin/events/${eventId}`);
  assert.ok(page.body.includes('Sokken\nChocolade?\nThee'));
});

test('a custom question is stored, shown back in the textarea and survives an unchanged save', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const save = (wishText) => t.adminPost(`/admin/events/${eventId}`, {
    name: 'Lootjes 2026', language: 'nl', cleanupWeeks: '4', themeText: '', wishOptions: wishText,
  });
  assert.equal((await save('Boeken? welke schrijver\nChocolade?\nThee')).statusCode, 303);
  const stored = t.ctx.repo.getEvent(eventId).wishOptions;
  assert.equal(stored[0].question, 'welke schrijver?');
  const page = await t.adminGet(`/admin/events/${eventId}`);
  const shown = 'Boeken? welke schrijver?\nChocolade?\nThee';
  assert.ok(page.body.includes(shown));
  assert.ok(page.body.includes('&quot;Boeken? Welke schrijver?&quot;'), 'the hint quotes its example');
  assert.ok(page.body.includes('Alleen een vraagteken'), 'the hint explains a lone question mark');
  await save(shown);
  assert.deepEqual(t.ctx.repo.getEvent(eventId).wishOptions, stored);
});

test('changing only the question keeps the option id and the saved likes', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId);
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: 'Ada\nBen\nCor' });
  const [ada] = t.ctx.repo.listParticipants(groupId);
  const save = (wishText) => t.adminPost(`/admin/events/${eventId}`, {
    name: 'Lootjes 2026', language: 'nl', cleanupWeeks: '4', themeText: '', wishOptions: wishText,
  });
  await save('Sokken? Welke maat?\nThee');
  const [socks] = t.ctx.repo.getEvent(eventId).wishOptions;
  saveWishes(t.ctx, ada.id, aboutBody({ q_likes: [socks.id], [`d_likes_${socks.id}`]: '42' }));
  for (const text of ['Sokken? Welke kleur?', 'Sokken?', 'Sokken? Welke kleur?']) {
    await save(`${text}\nThee`);
    const [now] = t.ctx.repo.getEvent(eventId).wishOptions;
    assert.equal(now.id, socks.id, text);
  }
  const { answers } = t.ctx.repo.getParticipant(ada.id).wishes;
  assert.deepEqual(answers.likes, { ticked: [socks.id], details: { [socks.id]: '42' } });
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

test('deleting a group or an event truncates the WAL, and a failing checkpoint does not fail the delete', async () => {
  const t = await setup();
  const calls = [];
  const real = t.ctx.repo.checkpoint;
  t.ctx.repo.checkpoint = () => {
    calls.push('checkpoint');
    real();
  };
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId);
  assert.equal((await t.adminPost(`/admin/groups/${groupId}/delete`)).statusCode, 400);
  assert.deepEqual(calls, [], 'nothing deleted, no checkpoint');
  assert.equal((await t.adminPost(`/admin/groups/${groupId}/delete`, { confirm: '1' })).statusCode, 303);
  assert.deepEqual(calls, ['checkpoint']);

  t.ctx.repo.checkpoint = () => {
    calls.push('checkpoint');
    throw new Error('database is locked');
  };
  const res = await t.adminPost(`/admin/events/${eventId}/delete`, { confirm: '1' });
  assert.equal(res.statusCode, 303);
  assert.equal(t.ctx.repo.getEvent(eventId), null);
  assert.deepEqual(calls, ['checkpoint', 'checkpoint']);
  assert.ok(t.logs.some((line) => line.includes('"msg":"checkpoint_failed"')));
});

test('unknown events and groups give the not-found page', async () => {
  const t = await setup();
  assert.equal((await t.adminGet('/admin/events/999')).statusCode, 404);
  assert.equal((await t.adminGet('/admin/groups/999')).statusCode, 404);
  assert.equal((await t.adminGet('/admin/groups/abc')).statusCode, 404);
  assert.equal((await t.adminPost('/admin/groups/999/invite')).statusCode, 404);
});

test('the same email twice in one pasted list needs confirmation', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, {
    text: 'Ada, ada@example.com\nBen\nCor\nAda Two, ADA@example.com',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('ada@example.com staat twee keer in de lijst.'));
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 0);
  const confirm = await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan: hiddenPlan(res.body) });
  assert.equal(confirm.statusCode, 303);
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 4);
});

test('pasting more people than the cap is refused with a form error', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const lines = Array.from({ length: 501 }, (_, i) => `Person ${i}`).join('\n');
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: lines });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes('Plak maximaal 500 mensen tegelijk.'));
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 0);
  const en = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: lines }, { cookie: `${t.adminCookie()}; giftdraw_lang=en` });
  assert.ok(en.body.includes('Paste at most 500 people at a time.'));
});

test('paste text over the length limit is refused, not truncated', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const text = `Ada, ada@example.com\n${'x'.repeat(200000)}`;
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes('Deze lijst is te lang.'));
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 0);
});

test('a maximal confirmation plan is accepted in full', async () => {
  const t = await setup();
  const groupId = await createGroup(t, await createEvent(t));
  const name = 'N'.repeat(100);
  // The longest address normaliseEmail accepts: 254 characters.
  const lines = Array.from({ length: 500 }, (_, i) => `${name}, ${String(i).padStart(3, '0')}${'e'.repeat(239)}@example.com`);
  lines.push('Bad, bad@');
  const res = await t.adminPost(`/admin/groups/${groupId}/participants`, { text: lines.join('\n') });
  assert.equal(res.statusCode, 200);
  const plan = hiddenPlan(res.body);
  assert.equal(JSON.parse(plan).rows.length, 500);
  const confirm = await t.adminPost(`/admin/groups/${groupId}/participants`, { confirm: '1', plan });
  assert.equal(confirm.statusCode, 303);
  assert.equal(t.ctx.repo.listParticipants(groupId).length, 500);
});

test('a past exchange date is refused for a new group but a stored one may stay', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const refused = await t.adminPost(`/admin/events/${eventId}/groups`, { name: 'Oud', exchangeDate: '2026-10-31', autoOpenAt: '' });
  assert.equal(refused.statusCode, 400);
  assert.ok(refused.body.includes('De ruildatum ligt in het verleden.'));
  assert.equal(t.ctx.repo.listGroups(eventId).length, 0);

  const groupId = t.ctx.repo.createGroup(eventId, { name: 'Oud', exchangeDate: '2026-10-30' }, t.ctx.nowIso());
  const rename = await t.adminPost(`/admin/groups/${groupId}`, { name: 'Ouder', exchangeDate: '2026-10-30', autoOpenAt: '' });
  assert.equal(rename.statusCode, 303);
  const moved = await t.adminPost(`/admin/groups/${groupId}`, { name: 'Ouder', exchangeDate: '2026-10-29', autoOpenAt: '' });
  assert.equal(moved.statusCode, 400);
  assert.equal(t.ctx.repo.getGroup(groupId).exchangeDate, '2026-10-30');
});

test('with email off the dashboard explains the invitation button and drops mail-only states', async () => {
  const t = await setup();
  const groupId = await groupOfFour(t);
  t.mailer.enabled = false;
  const page = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(page.body.includes('Deel de links zelf en druk dan op de knop'));
  assert.ok(page.body.includes('<span>De links zijn gedeeld</span></button>'));
  assert.ok(!page.body.includes('met e-mail uitgenodigd'));
  assert.ok(!page.body.includes('Nog niet</span>'));

  await t.adminPost(`/admin/groups/${groupId}/invite`);
  const shared = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(shared.body.includes('Je hebt aangegeven dat de links gedeeld zijn.'));
  assert.equal(shared.body.includes(`action="/admin/groups/${groupId}/invite"`), false);

  t.mailer.enabled = true;
  const on = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(on.body.includes('<span>Uitnodigingen versturen</span></button>'));
  assert.ok(on.body.includes('met e-mail uitgenodigd'));
});

// Sentences that speak of an invitation mail or of sending mail.
const MAIL_TALK = [
  'Komt in de uitnodiging', 'Uitnodigingen verstuurd op', 'mail te sturen', 'stuur de uitnodiging opnieuw',
  'Alleen als de uitnodigingen dan al verstuurd zijn',
];

test('with email off no organiser page speaks of an invitation mail', async () => {
  const t = await setup();
  const groupId = await groupOfFour(t);
  const eventId = t.ctx.repo.getGroup(groupId).eventId;
  const person = t.ctx.repo.listParticipants(groupId)[0];
  const pages = async () => [
    await t.adminGet(`/admin/events/${eventId}`),
    await t.adminGet(`/admin/groups/${groupId}`),
    await t.adminGet(`/admin/participants/${person.id}`),
  ].map((res) => res.body).join('\n');

  t.mailer.enabled = false;
  const before = await pages();
  assert.equal(before.includes('De uitnodigingen zijn nog niet verstuurd.'), false);
  assert.ok(before.includes('De links zijn nog niet gedeeld.'));
  await t.adminPost(`/admin/groups/${groupId}/invite`);
  const off = await pages();
  for (const phrase of MAIL_TALK) assert.equal(off.includes(phrase), false, phrase);
  assert.ok(off.includes('Links gedeeld op '));
  assert.ok(off.includes('Komt op het scherm van iedere deelnemer'));

  t.mailer.enabled = true;
  const on = await pages();
  for (const phrase of MAIL_TALK) assert.ok(on.includes(phrase), phrase);
});

test('a group keeps an exchange time and a one-line place, and empty values are null', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId, { exchangeTime: '10:30', exchangePlace: '  Yogastudio De Lotus\r\nDorpsstraat 1  ' });
  let group = t.ctx.repo.getGroup(groupId);
  assert.equal(group.exchangeTime, '10:30');
  assert.equal(group.exchangePlace, 'Yogastudio De Lotus Dorpsstraat 1');

  const page = await t.adminGet(`/admin/groups/${groupId}`);
  assert.ok(page.body.includes('om 10:30 bij Yogastudio De Lotus Dorpsstraat 1'), 'dashboard shows time and place');
  assert.match(page.body, /name="exchangeTime" type="time" value="10:30"/);

  const ok = await t.adminPost(`/admin/groups/${groupId}`, {
    name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', exchangeTime: '', exchangePlace: '   ',
  });
  assert.equal(ok.statusCode, 303);
  group = t.ctx.repo.getGroup(groupId);
  assert.equal(group.exchangeTime, null);
  assert.equal(group.exchangePlace, null);
});

test('a printed card goes out of date when the exchange details or the theme change, not on an unchanged save', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  const groupId = await createGroup(t, eventId, { exchangeTime: '10:30', exchangePlace: 'Studio' });
  await t.adminPost(`/admin/groups/${groupId}/participants`, { text: 'Ada\nBen\nCor' });
  const [ada] = t.ctx.repo.listParticipants(groupId);
  const reprint = 'Opnieuw printen';
  const outOfDate = async () => (await t.adminGet(`/admin/groups/${groupId}`)).body.includes(reprint);
  const print = () => {
    t.clock.ms += 60_000;
    t.ctx.repo.updateParticipant(ada.id, { printedAt: t.ctx.nowIso() });
    t.clock.ms += 60_000;
  };
  const group = { name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', exchangeTime: '10:30', exchangePlace: 'Studio' };
  const event = { name: 'Lootjes 2026', language: 'nl', cleanupWeeks: '4', themeText: '', wishOptions: '' };

  print();
  await t.adminPost(`/admin/groups/${groupId}`, { ...group, name: 'Maandagochtend' });
  await t.adminPost(`/admin/events/${eventId}`, { ...event, name: 'Lootjes' });
  assert.equal(await outOfDate(), false, 'name changes are not on the card');

  for (const change of [{ exchangeDate: '2026-12-19' }, { exchangeTime: '11:00' }, { exchangePlace: 'Zaal' }]) {
    print();
    assert.equal(await outOfDate(), false);
    await t.adminPost(`/admin/groups/${groupId}`, { ...group, ...change });
    assert.equal(await outOfDate(), true, JSON.stringify(change));
    Object.assign(group, change);
  }

  print();
  await t.adminPost(`/admin/events/${eventId}`, { ...event, themeText: 'Neem iets moois mee.' });
  assert.equal(await outOfDate(), true, 'theme change');
  print();
  await t.adminPost(`/admin/events/${eventId}`, { ...event, themeText: 'Neem iets moois mee.' });
  assert.equal(await outOfDate(), false, 'same theme again');
});

test('an invalid exchange time or an overlong place is refused with a form error', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  for (const exchangeTime of ['25:00', '9:30', '10:30:00', 'noon']) {
    const res = await t.adminPost(`/admin/events/${eventId}/groups`, {
      name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', exchangeTime,
    });
    assert.equal(res.statusCode, 400, exchangeTime);
    assert.ok(res.body.includes('Vul een geldige tijd in'), exchangeTime);
  }
  const long = await t.adminPost(`/admin/events/${eventId}/groups`, {
    name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', exchangePlace: 'x'.repeat(201),
  });
  assert.equal(long.statusCode, 400);
  assert.ok(long.body.includes('200 tekens'));
  assert.equal(t.ctx.repo.listGroups(eventId).length, 0);

  const groupId = await createGroup(t, eventId, { exchangePlace: 'y'.repeat(200) });
  const res = await t.adminPost(`/admin/groups/${groupId}`, {
    name: 'Maandag', exchangeDate: '2026-12-18', autoOpenAt: '', exchangeTime: '24:00',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /name="exchangeTime" type="time" value="24:00"/);
  assert.equal(t.ctx.repo.getGroup(groupId).exchangeTime, null);
});

test('the new-group form copies the previous time and place', async () => {
  const t = await setup();
  const eventId = await createEvent(t);
  let page = await t.adminGet(`/admin/events/${eventId}`);
  assert.match(page.body, /name="exchangeTime" type="time" value=""/);
  await createGroup(t, eventId, { exchangeTime: '19:45', exchangePlace: 'Buurthuis "De Kei"' });
  page = await t.adminGet(`/admin/events/${eventId}`);
  assert.match(page.body, /name="exchangeTime" type="time" value="19:45"/);
  assert.ok(page.body.includes('name="exchangePlace" type="text" maxlength="200" value="Buurthuis &quot;De Kei&quot;"'));
  assert.ok(page.body.includes('vrijdag 18 december om 19:45'), 'the group list shows the time');
});
