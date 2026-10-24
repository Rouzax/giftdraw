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

// A receiver mail goes to that receiver's giver and follows something the
// receiver did, so these lines carry no participant id.
test('receiver mails are logged without a participant id, sent or failed', async () => {
  const { ctx, mailer, ada, drain, logs } = await setup();
  ctx.repo.updateParticipant(ada.id, { drawnAt: ctx.nowIso() });
  for (const kind of ['wishes-updated', 'reassigned']) ctx.repo.enqueue(ada.id, kind, ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 2, failed: 0 });
  mailer.fail = () => Object.assign(new Error('down'), { code: 'ECONNECTION' });
  ctx.repo.enqueue(ada.id, 'reassigned', ctx.nowIso());
  assert.deepEqual(await drain(), { sent: 0, failed: 1 });
  const lines = logLines(logs).filter((l) => ['mail_sent', 'mail_failed'].includes(l.msg));
  assert.deepEqual(lines.map((l) => [l.msg, l.kind]), [
    ['mail_sent', 'wishes-updated'], ['mail_sent', 'reassigned'], ['mail_failed', 'reassigned'],
  ]);
  for (const line of lines) {
    assert.ok(Number.isInteger(line.outbox_id));
    assert.ok(!Object.hasOwn(line, 'participant_id'), line.kind);
  }
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

test('a reminder that no longer fits by send time is given up with stale-reminder', async () => {
  const { ctx, db, mails, ada, ben, cor, group, drain } = await setup();
  // Ada filled in her wishes, the group opened for Ben, and Cor drew: none
  // of the queued reminders asks for the right thing any more.
  const wishes = ctx.repo.enqueue(ada.id, 'remind-wishes', ctx.nowIso());
  const draw = ctx.repo.enqueue(ben.id, 'remind-wishes', ctx.nowIso());
  const drawn = ctx.repo.enqueue(cor.id, 'remind-draw', ctx.nowIso());
  const fits = ctx.repo.enqueue(ben.id, 'remind-draw', ctx.nowIso());
  ctx.repo.updateParticipant(ada.id, { wishes: { hobbies: 'Yoga' } });
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.markGroupOpened(group.id, ctx.nowIso());
  ctx.repo.updateParticipant(cor.id, { drawnAt: ctx.nowIso() });
  assert.deepEqual(await drain(), { sent: 1, failed: 3 });
  assert.deepEqual(mails.map((m) => m.to), [ben.email]);
  for (const id of [wishes, draw, drawn]) {
    assert.equal(outboxRow(db, id).status, 'gaveup');
    assert.equal(outboxRow(db, id).error_code, 'stale-reminder');
  }
  assert.equal(outboxRow(db, fits).status, 'sent');
  // Nothing went wrong, so the organiser sees no failure and nothing to send again.
  assert.equal(ctx.repo.mailStatus(ada.id).lastFailure, null);
  assert.equal(ctx.repo.requeueLastFailed(ada.id, ctx.nowIso()), false);
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

test('a markSent failure after a send retries markSent once and never resends', async () => {
  const { ctx, db, mails, ada, drain } = await setup();
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const real = ctx.repo.markSent;
  let calls = 0;
  ctx.repo.markSent = (...args) => {
    calls += 1;
    if (calls === 1) throw new Error('database is locked');
    return real(...args);
  };
  assert.deepEqual(await drain(), { sent: 1, failed: 0 });
  assert.equal(calls, 2);
  assert.equal(mails.length, 1);
  assert.equal(outboxRow(db, id).status, 'sent');
});

test('a markSent that keeps failing leaves the row sending, logs an error and does not mark it failed', async () => {
  const { ctx, db, mails, ada, drain, logs } = await setup();
  const id = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  ctx.repo.markSent = () => {
    throw new Error('database is locked');
  };
  let markFailedCalls = 0;
  const realFailed = ctx.repo.markFailed;
  ctx.repo.markFailed = (...args) => {
    markFailedCalls += 1;
    return realFailed(...args);
  };
  assert.deepEqual(await drain(), { sent: 1, failed: 0 });
  assert.equal(markFailedCalls, 0);
  assert.equal(mails.length, 1);
  const row = outboxRow(db, id);
  assert.equal(row.status, 'sending');
  assert.equal(row.error_code, null);
  const line = logLines(logs).find((l) => l.msg === 'mail_mark_failed');
  assert.equal(line.level, 50);
  assert.equal(line.outbox_id, id);
  assert.equal(line.participant_id, ada.id);
  assert.ok(!logs.some((l) => l.includes('mail_failed')));
  assert.deepEqual(await drain(), { sent: 0, failed: 0 });
  assert.equal(mails.length, 1);
});

test('a markFailed that throws does not strand the rest of the claimed batch', async () => {
  const { ctx, db, mailer, ada, ben, drain, logs } = await setup();
  mailer.fail = () => Object.assign(new Error('down'), { code: 'ECONNECTION' });
  const first = ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const second = ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  const real = ctx.repo.markFailed;
  ctx.repo.markFailed = (id, ...rest) => {
    if (id === first) throw new Error('database is locked');
    return real(id, ...rest);
  };
  assert.deepEqual(await drain(), { sent: 0, failed: 2 });
  assert.equal(outboxRow(db, first).status, 'sending');
  assert.equal(outboxRow(db, second).status, 'pending');
  assert.equal(outboxRow(db, second).error_code, 'ECONNECTION');
  const line = logLines(logs).find((l) => l.msg === 'mail_mark_failed');
  assert.equal(line.level, 50);
  assert.equal(line.outbox_id, first);
});

test('a drain request arriving while a drain runs is not lost', async () => {
  const { ctx, mails, mailer, ada, ben } = await setup();
  mailer.delayMs = 30;
  ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const running = drainOutbox(ctx);
  await new Promise((resolve) => setTimeout(resolve, 5));
  ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  const again = drainOutbox(ctx);
  assert.equal(again, running);
  assert.deepEqual(await running, { sent: 2, failed: 0 });
  assert.deepEqual(mails.map((m) => m.to), ['ada@example.com', 'ben@example.com']);
  assert.equal(ctx.state.drain, undefined);
});

test('a final give-up after retries logs at error, an immediate skip at warn', async () => {
  const { ctx, mailer, ada, ben, drain, clock, logs } = await setup();
  ctx.repo.updateParticipant(ben.id, { email: null });
  ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  await drain();
  const skip = logLines(logs).find((l) => l.msg === 'mail_failed');
  assert.equal(skip.code, 'no-email');
  assert.equal(skip.level, 40);
  mailer.fail = () => Object.assign(new Error('down'), { code: 'ECONNECTION' });
  ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  for (const minutes of [0, 1, 5, 30, 120]) {
    clock.ms += minutes * MINUTE;
    await drain();
  }
  const failures = logLines(logs).filter((l) => l.msg === 'mail_failed' && l.participant_id === ada.id);
  assert.deepEqual(failures.map((l) => l.level), [40, 40, 40, 40, 50]);
  assert.equal(failures.at(-1).gaveup, true);
});

test('once stopping, a drain finishes the send in flight and starts no other', async () => {
  const { ctx, db, mails, mailer, ada, ben } = await setup();
  mailer.delayMs = 20;
  ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  const second = ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  const running = drainOutbox(ctx);
  await new Promise((resolve) => setTimeout(resolve, 5));
  ctx.state.stopping = true;
  assert.deepEqual(await running, { sent: 1, failed: 0 });
  assert.equal(mails.length, 1);
  // Claimed but never attempted: requeueStale hands it back after a restart.
  assert.equal(outboxRow(db, second).status, 'sending');
  assert.deepEqual(await drainOutbox(ctx), { sent: 0, failed: 0 });
});

test('a given-up draw-open or invite sent again after the participant drew is skipped as stale', async () => {
  const { ctx, db, mails, ada, ben, group, drain } = await setup();
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.markGroupOpened(group.id, ctx.nowIso());
  const drawOpen = ctx.repo.enqueue(ada.id, 'draw-open', ctx.nowIso());
  const invite = ctx.repo.enqueue(ben.id, 'invite', ctx.nowIso());
  for (const id of [drawOpen, invite]) ctx.repo.markFailed(id, 'ECONNREFUSED', null, ctx.nowIso());
  // Both drew through a link the organiser passed on in the meantime.
  for (const p of [ada, ben]) ctx.repo.updateParticipant(p.id, { drawnAt: ctx.nowIso() });
  for (const p of [ada, ben]) assert.equal(ctx.repo.requeueLastFailed(p.id, ctx.nowIso()), true);
  await drain();
  assert.deepEqual(mails, []);
  for (const id of [drawOpen, invite]) assert.equal(outboxRow(db, id).error_code, 'stale-mail');
  assert.equal(ctx.repo.mailStatus(ada.id).lastFailure, null);
});

test('an invite to someone who has not drawn yet still goes out in an open group', async () => {
  const { ctx, mails, ada, group, drain } = await setup();
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  ctx.repo.markGroupOpened(group.id, ctx.nowIso());
  ctx.repo.enqueue(ada.id, 'invite', ctx.nowIso());
  ctx.repo.enqueue(ada.id, 'draw-open', ctx.nowIso());
  await drain();
  assert.deepEqual(mails.map((m) => m.to), [ada.email, ada.email]);
});
