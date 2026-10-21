import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainOutbox } from '../src/mail/outbox.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const MINUTE = 60_000;

async function setup(options = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms), ...options });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const [ada, ben, cor] = seeded.people;
  return { ...t, ...seeded, clock, ada, ben, cor };
}

const outboxRow = (db, id) => db.prepare('SELECT * FROM outbox WHERE id = ?').get(id);
const logLines = (logs) => logs.map((line) => JSON.parse(line));

test('a pending row is sent once and marked sent', async () => {
  const { ctx, db, mails, ada, drain, logs } = await setup();
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 1, failed: 0 });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'ada@example.com');
  assert.ok(mails[0].subject.startsWith('Lootjes trekken: '));
  assert.ok(mails[0].text.includes(`https://gifts.example.com/p/${ada.token}`));
  const row = outboxRow(db, id);
  assert.equal(row.status, 'sent');
  assert.equal(row.sent_at, ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 0, failed: 0 });
  assert.equal(mails.length, 1);
  const sent = logLines(logs).find((l) => l.msg === 'mail_sent');
  assert.deepEqual(
    { outbox_id: sent.outbox_id, participant_id: sent.participant_id, kind: sent.kind },
    { outbox_id: id, participant_id: ada.id, kind: 'invite' },
  );
  assert.ok(!logs.join('').includes('@'), 'no address in logs');
});

test('two concurrent drains with a slow mailer send each row once', async () => {
  const { ctx, mails, mailer, ada, ben, cor } = await setup();
  mailer.delayMs = 20;
  for (const p of [ada, ben, cor]) ctx.repo.enqueue(p.id, 'invite', ctx.nowIso());
  const first = drainOutbox(ctx);
  const second = drainOutbox(ctx);
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [{ sent: 3, failed: 0 }, { sent: 3, failed: 0 }]);
  assert.equal(mails.length, 3);
  assert.equal(ctx.state.drain, undefined, 'in-flight promise cleared');
});

test('a throwing mailer records a safe code, retries a minute later and stores no address', async () => {
  const { ctx, db, mails, mailer, ada, drain, logs } = await setup();
  mailer.fail = () => Object.assign(new Error('550 mailbox ada@example.com unknown'), { responseCode: 550 });
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 0, failed: 1 });
  assert.equal(mails.length, 0);
  const row = outboxRow(db, id);
  assert.equal(row.status, 'pending');
  assert.equal(row.error_code, 'smtp-550');
  assert.equal(row.attempts, 1);
  assert.equal(row.next_attempt_at, new Date(T0 + MINUTE).toISOString());
  assert.ok(!JSON.stringify(row).includes('@'));
  assert.ok(!logs.join('').includes('@'));
  assert.ok(!logs.join('').includes('mailbox'));
  const failed = logLines(logs).find((l) => l.msg === 'mail_failed');
  assert.equal(failed.code, 'smtp-550');
  assert.equal(failed.outbox_id, id);
});

test('error codes are err.code when short and safe, otherwise a fallback', async () => {
  const { ctx, db, mailer, ada, drain } = await setup();
  const cases = [
    [{ code: 'ECONNREFUSED', responseCode: 421 }, 'ECONNREFUSED'],
    [{ code: 'ada@example.com' }, 'error'],
    [{ code: 'x'.repeat(41), responseCode: 451 }, 'smtp-451'],
    [{}, 'error'],
  ];
  for (const [props, want] of cases) {
    mailer.fail = () => Object.assign(new Error('boom'), props);
    const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
    await drain();
    assert.equal(outboxRow(db, id).error_code, want, JSON.stringify(props));
    db.prepare('DELETE FROM outbox WHERE id = ?').run(id);
  }
});

test('backoff grows and after five failures the row is gaveup', async () => {
  const { ctx, db, mailer, ada, drain, clock } = await setup();
  mailer.fail = () => Object.assign(new Error('down'), { code: 'ECONNECTION' });
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const delays = [1, 5, 30, 120].map((m) => m * MINUTE);
  for (const delay of delays) {
    await drain();
    const row = outboxRow(db, id);
    assert.equal(row.status, 'pending');
    assert.equal(Date.parse(row.next_attempt_at) - clock.ms, delay);
    clock.ms += delay;
  }
  await drain();
  const row = outboxRow(db, id);
  assert.equal(row.attempts, 5);
  assert.equal(row.status, 'gaveup');
  assert.equal(row.error_code, 'ECONNECTION');
  clock.ms += 24 * 60 * MINUTE;
  assert.deepEqual(await drain(), { sent: 0, failed: 0 });
});

test('a row whose participant lookup throws does not stop the next row', async () => {
  const { ctx, db, mails, ada, ben, cor, group, drain } = await setup();
  // Ben's receiver is Ada, the participant whose lookup throws.
  ctx.repo.setAssignment(group.id, new Map([[ada.id, cor.id], [cor.id, ben.id], [ben.id, ada.id]]), ctx.nowIso());
  const bad = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const good = ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  const real = ctx.repo.getParticipant;
  ctx.repo.getParticipant = (id) => {
    if (id === ada.id) throw new Error('disk on fire');
    return real(id);
  };
  assert.deepEqual(await drain(), { sent: 1, failed: 1 });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'ben@example.com');
  assert.equal(outboxRow(db, bad).status, 'pending');
  assert.equal(outboxRow(db, bad).error_code, 'error');
  assert.equal(outboxRow(db, good).status, 'sent');
});

test('an invite is sent even when the receiver lookup would throw', async () => {
  const { ctx, db, mails, ada, ben, cor, group, drain } = await setup();
  ctx.repo.setAssignment(group.id, new Map([[ada.id, cor.id], [cor.id, ben.id], [ben.id, ada.id]]), ctx.nowIso());
  const id = ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  const real = ctx.repo.getParticipant;
  ctx.repo.getParticipant = (pid) => {
    if (pid === ada.id) throw new Error('disk on fire');
    return real(pid);
  };
  assert.deepEqual(await drain(), { sent: 1, failed: 0 });
  assert.equal(mails[0].to, 'ben@example.com');
  assert.equal(outboxRow(db, id).status, 'sent');
});

test('with the mailer disabled nothing is sent and rows stay pending', async () => {
  const { ctx, db, mails, mailer, ada, drain } = await setup();
  mailer.enabled = false;
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 0, failed: 0 });
  assert.equal(mails.length, 0);
  const row = outboxRow(db, id);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
});

test('a participant without email is given up with no-email', async () => {
  const { ctx, db, mails, ada, drain } = await setup();
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  ctx.repo.updateParticipant(ada.id, { email: null });
  assert.deepEqual(await drain(), { sent: 0, failed: 1 });
  assert.equal(mails.length, 0);
  assert.equal(outboxRow(db, id).status, 'gaveup');
  assert.equal(outboxRow(db, id).error_code, 'no-email');
});

test('a receiver-bound kind without a receiver is given up with no-receiver', async () => {
  const { ctx, db, mails, ada, group, drain } = await setup();
  ctx.repo.setAssignment(group.id, null, ctx.nowIso());
  const id = ctx.repo.enqueue(ada.id, 'reassigned', ctx.nowIso());
  const invite = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 1, failed: 1 });
  assert.equal(mails.length, 1);
  assert.equal(outboxRow(db, id).status, 'gaveup');
  assert.equal(outboxRow(db, id).error_code, 'no-receiver');
  assert.equal(outboxRow(db, invite).status, 'sent');
});

test('reassigned renders with the current receiver at send time', async () => {
  const { ctx, mails, ada, ben, cor, group, drain } = await setup();
  ctx.repo.enqueue(ada.id, 'reassigned', ctx.nowIso());
  ctx.repo.setAssignment(group.id, new Map([[ada.id, cor.id], [cor.id, ben.id], [ben.id, ada.id]]), ctx.nowIso());
  await drain();
  assert.ok(mails[0].text.includes('Cor'));
  assert.ok(!mails[0].text.includes('Ben'));
});

test('drain picks up more than one batch', async () => {
  const { ctx, mails, ada, drain } = await setup();
  for (let i = 0; i < 51; i += 1) ctx.repo.enqueue(ada.id, 'remind-wishes', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 51, failed: 0 });
  assert.equal(mails.length, 51);
});
