import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { saveWishes } from '../src/people.js';
import { cardOutOfDate } from '../src/status.js';
import { startScheduler, tick } from '../src/scheduler.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const MINUTE = 60_000;
// Five mornings after the seeded invitation, 09:00 Amsterdam (UTC+1): the
// first moment a remind-wishes may go out for a group without auto-open.
const WISHES_DUE = Date.parse('2026-11-06T08:00:00.000Z');

async function setup(seedOptions = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], ...seedOptions });
  return { ...t, ...seeded, clock };
}

const logLines = (logs) => logs.map((line) => JSON.parse(line));
const outboxRows = (db, kind) =>
  db.prepare(`SELECT * FROM outbox ${kind ? 'WHERE kind = ?' : ''} ORDER BY id`).all(...(kind ? [kind] : []));

test('auto-open fires at 09:00 Amsterdam on the date and not at 08:59', async () => {
  const { ctx, group, clock, db } = await setup();
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.updateGroup(group.id, { autoOpenAt: '2026-11-20' });
  clock.ms = Date.parse('2026-11-20T07:59:00.000Z');
  assert.equal((await tick(ctx)).opened, 0);
  assert.equal(ctx.repo.getGroup(group.id).openedAt, null);
  clock.ms = Date.parse('2026-11-20T08:00:00.000Z');
  assert.equal((await tick(ctx)).opened, 1);
  assert.equal(ctx.repo.getGroup(group.id).openedAt, '2026-11-20T08:00:00.000Z');
  assert.equal(outboxRows(db, 'draw-open').length, 3);
});

test('auto-open logs a fixed event and a second tick does not reopen', async () => {
  const { ctx, group, clock, logs, db } = await setup();
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.updateGroup(group.id, { autoOpenAt: '2026-11-20' });
  clock.ms = Date.parse('2026-11-20T08:00:00.000Z');
  await tick(ctx);
  clock.ms += MINUTE;
  assert.equal((await tick(ctx)).opened, 0);
  assert.equal(outboxRows(db, 'draw-open').length, 3);
  const line = logLines(logs).find((l) => l.msg === 'group_auto_opened');
  assert.equal(line.group_id, group.id);
});

test('a group with a past auto-open date and no invitations stays closed', async () => {
  const { ctx, group, clock } = await setup();
  ctx.repo.updateGroup(group.id, { autoOpenAt: '2026-11-02' });
  clock.ms = Date.parse('2026-11-10T12:00:00.000Z');
  assert.equal((await tick(ctx)).opened, 0);
  assert.equal(ctx.repo.getGroup(group.id).openedAt, null);
});

test('a 2-person group stays closed on its auto-open date', async () => {
  const clock = { ms: T0 };
  const { ctx } = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { group } = seedGroup(ctx, { names: ['Ada', 'Ben'] });
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.updateGroup(group.id, { autoOpenAt: '2026-11-02' });
  clock.ms = Date.parse('2026-11-02T08:00:00.000Z');
  assert.equal((await tick(ctx)).opened, 0);
  assert.equal(ctx.repo.getGroup(group.id).openedAt, null);
});

function markGiverDrawn(t, receiver) {
  const giver = t.ctx.repo.giverOf(receiver.id);
  t.ctx.repo.updateParticipant(giver.id, { drawnAt: t.ctx.nowIso() });
  return giver;
}

test('three wish saves within 15 minutes give one wishes-updated to the drawn giver', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, mails, db, people } = t;
  const ben = people[1];
  const giver = markGiverDrawn(t, ben);
  const start = clock.ms;
  for (const offset of [0, 5, 10]) {
    clock.ms = start + offset * MINUTE;
    saveWishes(ctx, ben.id, { hobbies: `reading ${offset}` });
  }
  assert.equal(ctx.repo.getParticipant(ben.id).notifyGiverDueAt, new Date(start + 15 * MINUTE).toISOString());
  clock.ms = start + 14 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 0);
  clock.ms = start + 15 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 1);
  clock.ms = start + 30 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 0);
  const rows = outboxRows(db, 'wishes-updated');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].participant_id, giver.id);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, giver.email);
  assert.ok(mails[0].text.includes('reading 10'), 'mail carries the latest wishes');
  assert.equal(ctx.repo.getParticipant(ben.id).notifyGiverDueAt, null);
});

// The pairing is secret, so no wish-update line may tie a receiver to a
// giver, not even through a reason that describes the giver.
const noPairing = (line, giverId) => {
  assert.ok(!Object.hasOwn(line, 'giver_id'));
  assert.ok(!Object.values(line).includes(giverId));
};

test('a queued wishes-updated mail logs no participant ids', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, logs, people } = t;
  const ben = people[1];
  const giver = markGiverDrawn(t, ben);
  saveWishes(ctx, ben.id, { hobbies: 'secret hobby' });
  clock.ms += 15 * MINUTE;
  await tick(ctx);
  const queued = logLines(logs).filter((l) => l.msg === 'wish_update_queued');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].level, 30);
  assert.ok(!Object.hasOwn(queued[0], 'participant_id'));
  assert.ok(!Object.values(queued[0]).includes(ben.id));
  noPairing(queued[0], giver.id);
  const text = logs.join('');
  for (const leak of ['@', 'secret hobby', ben.name, giver.name]) assert.ok(!text.includes(leak), leak);
});

const dropped = (logs) => logLines(logs).filter((l) => l.msg === 'wish_update_dropped');

test('a cleared flag without a mail logs the reason at info', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, logs, people, group } = t;
  const ben = people[1];
  const giver = markGiverDrawn(t, ben);
  saveWishes(ctx, ben.id, { hobbies: 'reading' });
  const map = ctx.repo.getAssignment(group.id);
  ctx.repo.setAssignment(group.id, new Map([...map].map(([g, r]) => [r, g])), ctx.nowIso());
  clock.ms += 15 * MINUTE;
  await tick(ctx);
  const [line] = dropped(logs);
  assert.equal(line.level, 30);
  assert.ok(!Object.hasOwn(line, 'participant_id'), 'a giver-describing reason names no receiver');
  assert.ok(!Object.values(line).includes(ben.id));
  noPairing(line, ctx.repo.giverOf(ben.id).id);
  noPairing(line, giver.id);
  assert.equal(line.reason, 'giver-not-drawn');
  assert.equal(logLines(logs).filter((l) => l.msg === 'wish_update_queued').length, 0);
});

test('a drawn giver without email or with mail off drops the update with that reason', async () => {
  for (const [reason, prepare, receiverLogged] of [
    ['giver-no-email', (t, giver) => t.ctx.repo.updateParticipant(giver.id, { email: null }), false],
    ['mail-off', (t) => { t.mailer.enabled = false; }, true],
  ]) {
    const t = await setup({ opened: true });
    const ben = t.people[1];
    const giver = markGiverDrawn(t, ben);
    saveWishes(t.ctx, ben.id, { hobbies: 'reading' });
    prepare(t, giver);
    t.clock.ms += 15 * MINUTE;
    await tick(t.ctx);
    assert.deepEqual(
      dropped(t.logs).map((l) => [l.participant_id, l.reason]),
      [[receiverLogged ? ben.id : undefined, reason]],
      reason,
    );
    noPairing(dropped(t.logs)[0], giver.id);
  }
});

test('wish saves before the giver drew set no flag and send nothing', async () => {
  const { ctx, clock, db, people } = await setup({ opened: true });
  const ben = people[1];
  saveWishes(ctx, ben.id, { hobbies: 'reading' });
  assert.equal(ctx.repo.getParticipant(ben.id).notifyGiverDueAt, null);
  clock.ms += 20 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 0);
  assert.equal(outboxRows(db, 'wishes-updated').length, 0);
});

test('a flag set before a reassignment to a giver who has not drawn sends nothing', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, db, people, group } = t;
  const ben = people[1];
  const giver = markGiverDrawn(t, ben);
  saveWishes(ctx, ben.id, { hobbies: 'reading' });
  // Reverse the three-person cycle: Ben's new giver is the one who has not drawn.
  const map = ctx.repo.getAssignment(group.id);
  ctx.repo.setAssignment(group.id, new Map([...map].map(([g, r]) => [r, g])), ctx.nowIso());
  const newGiver = ctx.repo.giverOf(ben.id);
  assert.notEqual(newGiver.id, giver.id);
  assert.equal(newGiver.drawnAt, null);
  clock.ms += 15 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 0);
  assert.equal(outboxRows(db, 'wishes-updated').length, 0);
  assert.equal(ctx.repo.getParticipant(ben.id).notifyGiverDueAt, null);
});

test('saving the same wishes again changes nothing: no flag, no update time, card still current', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, db, people } = t;
  const ben = people[1];
  const form = { hobbies: 'reading', likes: ['tea', 'chocolate'], detail_chocolate: 'dark', pets: 'cat' };
  saveWishes(ctx, ben.id, form);
  const savedAt = ctx.repo.getParticipant(ben.id).wishesUpdatedAt;
  const giver = markGiverDrawn(t, ben);
  clock.ms += MINUTE;
  ctx.repo.updateParticipant(giver.id, { printedAt: ctx.nowIso() });

  clock.ms += MINUTE;
  saveWishes(ctx, ben.id, form);
  // Never filled in and saved empty is no change either.
  saveWishes(ctx, people[2].id, {});
  const after = ctx.repo.getParticipant(ben.id);
  assert.equal(after.wishesUpdatedAt, savedAt);
  assert.equal(after.notifyGiverDueAt, null);
  assert.equal(cardOutOfDate(ctx.repo.getParticipant(giver.id), after, ctx.repo.getGroup(t.group.id), t.event), false);
  assert.equal(ctx.repo.getParticipant(people[2].id).wishesUpdatedAt, null);
  clock.ms += 20 * MINUTE;
  assert.equal((await tick(ctx)).wishUpdates, 0);
  assert.equal(outboxRows(db, 'wishes-updated').length, 0);

  saveWishes(ctx, ben.id, { ...form, hobbies: 'reading, walking' });
  const changed = ctx.repo.getParticipant(ben.id);
  assert.equal(changed.wishesUpdatedAt, ctx.nowIso());
  assert.ok(changed.notifyGiverDueAt);
  assert.equal(cardOutOfDate(ctx.repo.getParticipant(giver.id), changed, ctx.repo.getGroup(t.group.id), t.event), true);
});

test('a reminder is enqueued once per rule', async () => {
  const { ctx, clock, db, mails } = await setup();
  clock.ms = WISHES_DUE - MINUTE;
  assert.equal((await tick(ctx)).reminders, 0);
  clock.ms = WISHES_DUE;
  assert.equal((await tick(ctx)).reminders, 3);
  clock.ms += MINUTE;
  assert.equal((await tick(ctx)).reminders, 0);
  assert.equal(outboxRows(db, 'remind-wishes').length, 3);
  assert.equal(mails.length, 3);
});

test('a tick while a slow mailer still sends the previous tick does not enqueue or send again', async () => {
  const { ctx, clock, db, mails, mailer } = await setup();
  mailer.delayMs = 40;
  clock.ms = WISHES_DUE;
  const first = tick(ctx);
  clock.ms += MINUTE;
  const second = tick(ctx);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.reminders, 3);
  assert.equal(b.reminders, 0);
  assert.equal(outboxRows(db, 'remind-wishes').length, 3);
  assert.equal(mails.length, 3);
});

test('with startScheduler a send that resolves after the interval still yields one mail', async () => {
  const { ctx, clock, db, mails, mailer, people } = await setup();
  for (const p of people.slice(1)) ctx.repo.updateParticipant(p.id, { email: null });
  mailer.delayMs = 60;
  clock.ms = WISHES_DUE;
  const scheduler = startScheduler(ctx, 10);
  await wait(200);
  await scheduler.stop();
  assert.equal(outboxRows(db, 'remind-wishes').length, 1);
  assert.equal(mails.length, 1);
});

test('stop awaits the running tick and cancels the next one', async () => {
  const { ctx, clock, db, mails, mailer } = await setup();
  mailer.delayMs = 30;
  clock.ms = WISHES_DUE;
  const scheduler = startScheduler(ctx, 10);
  await wait(5);
  await scheduler.stop();
  assert.equal(mails.length, 3, 'the running tick finished its sends');
  // A tick now would send the second round of reminders.
  clock.ms += 5 * 24 * 60 * MINUTE;
  await wait(50);
  assert.equal(outboxRows(db, 'remind-wishes').length, 3);
});

test('a participant row with a corrupt language does not stop the next participant\'s reminder', async () => {
  const { ctx, clock, db, logs, people } = await setup();
  const [ada, ben, cor] = people;
  db.prepare('UPDATE participants SET language = ? WHERE id = ?').run('xx-\u0000', ada.id);
  // The corrupt row also breaks its history lookup, so the row fails in the tick itself.
  const real = ctx.repo.reminderHistory;
  ctx.repo.reminderHistory = (id, kind) => {
    if (id === ada.id) throw new Error('corrupt row');
    return real(id, kind);
  };
  clock.ms = WISHES_DUE;
  assert.equal((await tick(ctx)).reminders, 2);
  const ids = outboxRows(db, 'remind-wishes').map((r) => r.participant_id);
  assert.deepEqual(ids, [ben.id, cor.id]);
  const error = logLines(logs).find((l) => l.msg === 'tick_row_error');
  assert.equal(error.participant_id, ada.id);
  assert.equal(error.step, 'reminders');
  assert.ok(!logs.join('').includes('@'));
});

test('a group past exchange date plus cleanup weeks is deleted with its people and mail; one day short is kept', async () => {
  const clock = { ms: T0 };
  const { ctx, db, logs } = await makeTestApp({ clock: () => new Date(clock.ms) });
  const gone = seedGroup(ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const kept = seedGroup(ctx, { names: ['Dirk', 'Eva', 'Fay'] });
  // Exchange 2026-12-18 + 4 weeks = 2027-01-15; the kept group's is 2027-01-17.
  ctx.repo.updateGroup(kept.group.id, { exchangeDate: '2026-12-20' });
  for (const p of [...gone.people, ...kept.people]) ctx.repo.enqueue(p.id, 'invite', ctx.nowIso());
  ctx.repo.updateParticipant(gone.people[0].id, { email: null });
  clock.ms = Date.parse('2027-01-16T12:00:00.000Z');
  assert.equal((await tick(ctx)).deleted, 1);
  assert.equal(ctx.repo.getGroup(gone.group.id), null);
  assert.equal(ctx.repo.listParticipants(gone.group.id).length, 0);
  const left = db.prepare('SELECT participant_id FROM outbox').all().map((r) => r.participant_id);
  assert.deepEqual(left, kept.people.map((p) => p.id));
  assert.ok(ctx.repo.getGroup(kept.group.id));
  assert.equal(ctx.repo.listParticipants(kept.group.id).length, 3);
  const cleaned = logLines(logs).find((l) => l.msg === 'groups_cleaned');
  assert.equal(cleaned.count, 1);
});

test('a sending row older than 10 minutes is retried', async () => {
  const { ctx, clock, db, mails, people } = await setup();
  const id = ctx.repo.enqueue(people[0].id, 'invite', ctx.nowIso());
  ctx.repo.claimDue(ctx.nowIso(), 10);
  clock.ms = T0 + 10 * MINUTE;
  await tick(ctx);
  assert.equal(db.prepare('SELECT status FROM outbox WHERE id = ?').get(id).status, 'sending');
  assert.equal(mails.length, 0);
  clock.ms = T0 + 10 * MINUTE + 1;
  await tick(ctx);
  assert.equal(db.prepare('SELECT status FROM outbox WHERE id = ?').get(id).status, 'sent');
  assert.equal(mails.length, 1);
});

test('a tick logs tick_done at debug with counts and a duration', async () => {
  const clock = { ms: T0 };
  const { ctx, logs } = await makeTestApp({ clock: () => new Date(clock.ms), configOverrides: { logLevel: 'debug' } });
  ctx.log.level = 'debug';
  await tick(ctx);
  const done = logLines(logs).find((l) => l.msg === 'tick_done');
  assert.equal(done.level, 20);
  assert.deepEqual(
    { opened: done.opened, reminders: done.reminders, wishUpdates: done.wish_updates, deleted: done.deleted },
    { opened: 0, reminders: 0, wishUpdates: 0, deleted: 0 },
  );
  assert.equal(typeof done.duration_ms, 'number');
  assert.equal(done.outcome, 'success');
});

test('with mail off the tick queues no reminders or wish updates', async () => {
  const t = await setup({ opened: true });
  const { ctx, clock, db, mailer, people } = t;
  mailer.enabled = false;
  const ben = people[1];
  markGiverDrawn(t, ben);
  saveWishes(ctx, ben.id, { hobbies: 'reading' });
  clock.ms = Date.parse('2026-12-12T08:00:00.000Z');
  const result = await tick(ctx);
  assert.equal(result.reminders, 0);
  assert.equal(result.wishUpdates, 0);
  assert.equal(outboxRows(db).length, 0);
});
