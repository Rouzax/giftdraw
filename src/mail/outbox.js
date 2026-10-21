import { RECEIVER_KINDS, renderEmail } from './templates.js';

const BATCH = 50;
const MINUTE = 60_000;
// Delay before the next try, indexed by the attempt that just failed. A
// failure on the attempt past the end of this list gives the row up.
const BACKOFF_MS = [1, 5, 30, 120].map((m) => m * MINUTE);
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const SAFE_CODE = /^[A-Z0-9_-]{1,40}$/i;

// Only a short code is kept: SMTP error messages and objects quote addresses
// and server replies, which must stay out of the database and the logs.
export function errorCode(err) {
  if (typeof err?.code === 'string' && SAFE_CODE.test(err.code)) return err.code;
  if (Number.isInteger(err?.responseCode)) return `smtp-${err.responseCode}`;
  return 'error';
}

class Skip extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function prepare(ctx, row) {
  const { repo, config } = ctx;
  const participant = repo.getParticipant(row.participantId);
  if (!participant) throw new Skip('no-participant');
  if (!participant.email) throw new Skip('no-email');
  const group = repo.getGroup(participant.groupId);
  const event = group && repo.getEvent(group.eventId);
  if (!event) throw new Skip('no-group');
  // Only receiver kinds load the receiver, so a failing lookup of someone
  // else's row cannot take down a mail that never uses it.
  let receiver = null;
  if (RECEIVER_KINDS.has(row.kind)) {
    receiver = participant.receiverId ? repo.getParticipant(participant.receiverId) : null;
    if (!receiver) throw new Skip('no-receiver');
  }
  const lang = participant.language;
  const link = `${config.appUrl}/p/${participant.token}`;
  const mail = renderEmail(row.kind, { lang, participant, receiver, event, group, link, tz: config.tz });
  return { to: participant.email, ...mail };
}

async function sendOne(ctx, row) {
  const fields = { outbox_id: row.id, participant_id: row.participantId, kind: row.kind };
  try {
    const message = prepare(ctx, row);
    await ctx.mailer.send(message);
    ctx.repo.markSent(row.id, ctx.nowIso());
    ctx.log.info(fields, 'mail_sent');
    return true;
  } catch (err) {
    const skipped = err instanceof Skip;
    const code = errorCode(err);
    const now = ctx.now();
    const retry = !skipped && row.attempts < MAX_ATTEMPTS;
    const next = retry ? new Date(now.getTime() + BACKOFF_MS[row.attempts - 1]).toISOString() : null;
    ctx.repo.markFailed(row.id, code, next, now.toISOString());
    ctx.log.warn({ ...fields, code, attempts: row.attempts, gaveup: !retry }, 'mail_failed');
    return false;
  }
}

async function drain(ctx) {
  const result = { sent: 0, failed: 0 };
  if (!ctx.mailer.enabled) return result;
  let rows;
  do {
    rows = ctx.repo.claimDue(ctx.nowIso(), BATCH);
    // One at a time: the pool has two connections and mail volume is small,
    // so ordering and a gentle send rate matter more than throughput.
    for (const row of rows) {
      if (await sendOne(ctx, row)) result.sent += 1;
      else result.failed += 1;
    }
  } while (rows.length === BATCH);
  return result;
}

// A second call while a drain runs gets the same promise, so two triggers
// close together never claim and send in parallel.
export function drainOutbox(ctx) {
  if (!ctx.state.drain) {
    ctx.state.drain = drain(ctx).finally(() => {
      ctx.state.drain = undefined;
    });
  }
  return ctx.state.drain;
}

export function kickDrain(ctx) {
  setImmediate(() => {
    drainOutbox(ctx).catch((err) => ctx.log.error({ code: errorCode(err) }, 'drain_error'));
  });
}
