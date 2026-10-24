import { reminderKind } from '../reminders.js';
import { wishForm } from '../wishes.js';
import { SKIP_CODES } from './skip-codes.js';
import { RECEIVER_KINDS, renderEmail } from './templates.js';

const BATCH = 50;
const MINUTE = 60_000;
// Delay before the next try, indexed by the attempt that just failed. A
// failure on the attempt past the end of this list gives the row up.
const BACKOFF_MS = [1, 5, 30, 120].map((m) => m * MINUTE);
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const SAFE_CODE = /^[A-Z0-9_-]{1,40}$/i;
const REMINDER_KINDS = new Set(['remind-wishes', 'remind-draw']);

// Only a short code is kept: SMTP error messages and objects quote addresses
// and server replies, which must stay out of the database and the logs. The
// reply number goes with it (EENVELOPE-550), and -FROM when the server
// refused the sender rather than the recipient, so the organiser's page can
// tell those apart.
export function errorCode(err) {
  const reply = Number.isInteger(err?.responseCode) && err.responseCode >= 200 && err.responseCode <= 599
    ? err.responseCode : null;
  const from = reply !== null && /^MAIL FROM/i.test(String(err?.command ?? '')) ? '-FROM' : '';
  if (typeof err?.code === 'string' && SAFE_CODE.test(err.code)) {
    const full = reply === null ? err.code : `${err.code}-${reply}${from}`;
    return SAFE_CODE.test(full) ? full : err.code;
  }
  if (reply !== null) return `smtp-${reply}${from}`;
  return 'error';
}

class Skip extends Error {
  constructor(code) {
    if (!SKIP_CODES.includes(code)) throw new Error(`unknown skip code ${code}`);
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
  // A reminder waits in the queue for a retry or a busy drain; by then the
  // wishes may be in, the draw open or done, and it would ask the wrong thing.
  if (REMINDER_KINDS.has(row.kind) && reminderKind(participant, group, wishForm(event)) !== row.kind) throw new Skip('stale-reminder');
  // The same for a draw-open or invite sent again by hand after giving up:
  // someone who has drawn since must not be asked to start.
  if ((row.kind === 'draw-open' || row.kind === 'invite') && participant.drawnAt) throw new Skip('stale-mail');
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

// The mail has gone out, so a failing markSent must never lead to
// markFailed and a retry. One more try covers a brief lock; after that the
// row is left 'sending' and logged, and requeueStale will resend it only if
// the database has recovered by then.
function recordSent(ctx, row, fields) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      ctx.repo.markSent(row.id, ctx.nowIso());
      return;
    } catch (err) {
      if (attempt === 2) ctx.log.error({ ...fields, code: errorCode(err), step: 'sent' }, 'mail_mark_failed');
    }
  }
}

async function sendOne(ctx, row) {
  // A receiver mail goes to that receiver's giver, and its timing follows
  // something the receiver did (a wish save, a removal), so its recipient id
  // would reveal who gives to whom. The outbox id still finds the row.
  const fields = RECEIVER_KINDS.has(row.kind)
    ? { outbox_id: row.id, kind: row.kind }
    : { outbox_id: row.id, participant_id: row.participantId, kind: row.kind };
  try {
    await ctx.mailer.send(prepare(ctx, row));
  } catch (err) {
    const skipped = err instanceof Skip;
    const code = errorCode(err);
    const now = ctx.now();
    const retry = !skipped && row.attempts < MAX_ATTEMPTS;
    const next = retry ? new Date(now.getTime() + BACKOFF_MS[row.attempts - 1]).toISOString() : null;
    // A row that cannot be marked stays 'sending'; requeueStale retries it.
    try {
      ctx.repo.markFailed(row.id, code, next, now.toISOString());
    } catch (markErr) {
      ctx.log.error({ ...fields, code: errorCode(markErr), step: 'failed' }, 'mail_mark_failed');
    }
    // A skip is the queue working as meant (the mail no longer applies), so
    // it needs no one's attention.
    const level = skipped ? 'info' : retry ? 'warn' : 'error';
    ctx.log[level]({ ...fields, code, attempts: row.attempts, gaveup: !retry }, 'mail_failed');
    return false;
  }
  recordSent(ctx, row, fields);
  ctx.log.info(fields, 'mail_sent');
  return true;
}

async function drain(ctx) {
  const result = { sent: 0, failed: 0 };
  if (!ctx.mailer.enabled) return result;
  let rows;
  do {
    if (ctx.state.stopping) break;
    rows = ctx.repo.claimDue(ctx.nowIso(), BATCH);
    // One at a time: the pool has two connections and mail volume is small,
    // so ordering and a gentle send rate matter more than throughput.
    for (const row of rows) {
      // Shutdown waits only for the send in flight. Rows claimed but not
      // tried stay 'sending' until requeueStale hands them back.
      if (ctx.state.stopping) break;
      if (await sendOne(ctx, row)) result.sent += 1;
      else result.failed += 1;
    }
  } while (rows.length === BATCH);
  return result;
}

// A second call while a drain runs gets the same promise, so two triggers
// close together never claim and send in parallel. It also flags one more
// pass, because rows queued after the running pass claimed its batch would
// otherwise wait for the next trigger.
export function drainOutbox(ctx) {
  if (ctx.state.drain) {
    ctx.state.drainAgain = true;
    return ctx.state.drain;
  }
  ctx.state.drain = (async () => {
    const total = { sent: 0, failed: 0 };
    try {
      do {
        ctx.state.drainAgain = false;
        const { sent, failed } = await drain(ctx);
        total.sent += sent;
        total.failed += failed;
      } while (ctx.state.drainAgain && !ctx.state.stopping);
      return total;
    } finally {
      ctx.state.drain = undefined;
      ctx.state.drainAgain = false;
    }
  })();
  return ctx.state.drain;
}

export function kickDrain(ctx) {
  setImmediate(() => {
    drainOutbox(ctx).catch((err) => ctx.log.error({ code: errorCode(err) }, 'drain_error'));
  });
}
