import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openGroup } from '../src/drawing.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup(seed = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor', 'Dirk'], ...seed });
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

// An invite row as the outbox leaves it after a send or a final failure.
function inviteRow(t, participantId, outcome) {
  const id = t.ctx.repo.enqueue(participantId, 'invite', t.ctx.nowIso());
  if (outcome === 'sent') t.ctx.repo.markSent(id, t.ctx.nowIso());
  else t.ctx.repo.markFailed(id, outcome, null, t.ctx.nowIso());
  t.clock.ms += 60_000;
  return id;
}

test('once everyone with email is invited the dashboard says so instead of offering the button', async () => {
  const t = await setup({ invited: false });
  let page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(page.body.includes(`action="/admin/groups/${t.groupId}/invite"`));
  await t.adminPost(`/admin/groups/${t.groupId}/invite`);
  page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(page.body.includes(`action="/admin/groups/${t.groupId}/invite"`), false);
  assert.ok(page.body.includes('Iedereen met e-mail is uitgenodigd.'));
});

test('a group of people without email still gets the button that lets the draw open', async () => {
  const t = await setup({ invited: false, withEmail: false });
  let page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(page.body.includes(`action="/admin/groups/${t.groupId}/invite"`));
  await t.adminPost(`/admin/groups/${t.groupId}/invite`);
  page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(page.body.includes('Niemand in deze groep heeft e-mail; deel de links zelf.'));
  assert.equal(page.body.includes('Iedereen met e-mail is uitgenodigd.'), false);
});

test('saving the event settings says it was saved', async () => {
  const t = await setup();
  const eventId = t.group.eventId;
  const res = await t.adminPost(`/admin/events/${eventId}`, { name: 'Gifts 2026', language: 'nl', cleanupWeeks: '4' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/events/${eventId}?done=saved`);
  const page = await t.adminGet(res.headers.location);
  assert.ok(page.body.includes('<p class="notice done" role="status">Opgeslagen.</p>'));
});

test('a failed resend leaves the delivered invitation in the invited column and the failure in its own', async () => {
  const t = await setup();
  const ada = t.people[0];
  inviteRow(t, ada.id, 'sent');
  inviteRow(t, ada.id, 'ESOCKET');
  assert.equal(t.ctx.repo.mailStatus(ada.id).invite, 'sent');
  assert.equal(t.ctx.repo.mailStatus(ada.id).lastFailure.kind, 'invite');
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  const row = page.body.slice(page.body.indexOf(`/admin/participants/${ada.id}"`));
  const invited = row.slice(row.indexOf('data-label="Uitgenodigd"'), row.indexOf('data-label="Link geopend'));
  assert.ok(invited.includes('Verstuurd'));
  assert.equal(invited.includes('Mislukt'), false);
});

test('an invitation that never got through still shows as failed', async () => {
  const t = await setup();
  inviteRow(t, t.people[0].id, 'ESOCKET');
  assert.equal(t.ctx.repo.mailStatus(t.people[0].id).invite, 'failed');
});

test('a mail failure is explained in words, with its code beside it', async () => {
  const t = await setup();
  const [ada, ben, cor] = t.people;
  inviteRow(t, ada.id, 'ECONNECTION');
  inviteRow(t, ben.id, 'EAUTH');
  inviteRow(t, cor.id, 'EWEIRD');
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(page.body.includes('De mailserver was niet te bereiken'));
  assert.ok(page.body.includes('Inloggen bij de mailserver lukte niet'));
  assert.ok(page.body.includes('De mail kon niet worden verstuurd'));
  for (const code of ['ECONNECTION', 'EAUTH', 'EWEIRD']) assert.ok(page.body.includes(`<code>${code}</code>`), code);
  const person = await t.adminGet(`/admin/participants/${ben.id}`);
  assert.ok(person.body.includes('Inloggen bij de mailserver lukte niet'));
});

test('a failure reason follows the SMTP reply and tells a refused sender from a refused address', async () => {
  const t = await setup();
  const cases = [
    ['EMESSAGE-554', 'De mailserver weigerde de mail.'],
    ['EMESSAGE', 'De mailserver weigerde de mail.'],
    ['EENVELOPE-553-FROM', 'De mailserver weigerde het afzenderadres.'],
    ['EENVELOPE-550', 'De mailserver weigerde het adres.'],
    ['EENVELOPE-450', 'De mailserver kon de mail even niet aannemen.'],
    ['smtp-421', 'De mailserver kon de mail even niet aannemen.'],
    ['EAUTH-535', 'Inloggen bij de mailserver lukte niet.'],
    ['ECONNREFUSED-421', 'De mailserver was niet te bereiken.'],
  ];
  for (const [code, reason] of cases) {
    const id = inviteRow(t, t.people[0].id, code);
    const page = await t.adminGet(`/admin/participants/${t.people[0].id}`);
    const shown = page.body.slice(page.body.indexOf('Laatste mailfout'));
    assert.ok(shown.includes(reason), code);
    assert.ok(shown.includes(`<code>${code}</code>`), code);
    t.db.prepare('DELETE FROM outbox WHERE id = ?').run(id);
  }
});

test('with email off the dashboard drops the mail columns and the remove page the mail sentence', async () => {
  const t = await setup();
  t.mailer.enabled = false;
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  for (const gone of ['Uitgenodigd', 'Mailfout', 'mailscanners', 'Laatste herinnering']) assert.equal(page.body.includes(gone), false, gone);
  assert.ok(page.body.includes('Link geopend'));
  const remove = await t.adminGet(`/admin/participants/${t.people[0].id}/remove`);
  assert.equal(remove.body.includes('mails die nog niet weg zijn'), false);
  assert.ok(remove.body.includes('De persoonlijke link werkt dan niet meer'));
  t.mailer.enabled = true;
  const on = await t.adminGet(`/admin/participants/${t.people[0].id}/remove`);
  assert.ok(on.body.includes('mails die nog niet weg zijn'));
});

test('the bar over a draw on someone\'s behalf says the organiser is looking on, not filling in', async () => {
  const t = await setup({ opened: true });
  const ada = t.people[0];
  const draw = await t.adminPost(`/admin/participants/${ada.id}/draw`);
  assert.equal(draw.statusCode, 200);
  assert.ok(draw.body.includes('Je kijkt mee met Ada.'));
  assert.equal(draw.body.includes('Je vult dit in voor Ada.'), false);
  const about = await t.adminGet(`/admin/participants/${ada.id}/about`);
  assert.ok(about.body.includes('Je vult dit in voor Ada.'));
});

test('opening a group sends no draw-open to someone whose invitation is still on its way', async () => {
  const t = await setup({ invited: false });
  await t.adminPost(`/admin/groups/${t.groupId}/invite`);
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: true });
  const kinds = t.db.prepare('SELECT kind FROM outbox WHERE participant_id = ? ORDER BY id').all(t.people[0].id).map((r) => r.kind);
  assert.deepEqual(kinds, ['invite']);
});

// An invitation already being sent was worded before the group opened, so
// it cannot stand in for the draw-open mail.
test('opening a group still sends a draw-open to someone whose invitation is mid-send', async () => {
  const t = await setup({ invited: false });
  await t.adminPost(`/admin/groups/${t.groupId}/invite`);
  const ada = t.people[0];
  t.db.prepare("UPDATE outbox SET status = 'sending' WHERE participant_id = ?").run(ada.id);
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: true });
  const kinds = t.db.prepare('SELECT kind FROM outbox WHERE participant_id = ? ORDER BY id').all(ada.id).map((r) => r.kind);
  assert.deepEqual(kinds, ['invite', 'draw-open']);
});
