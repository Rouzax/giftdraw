import { errorCode } from './mail/outbox.js';

// Below Docker's default 10 s stop timeout, so the forced exit is ours.
const SHUTDOWN_DEADLINE_MS = 8_000;

// Order matters: nothing may touch the database or the mail pool after they
// close, so first the timer and the request handlers stop, then the send in
// flight finishes. A send to an unresponsive mail server can hang that last
// step, so a second signal or the deadline forces the exit instead.
export function createShutdown({ ctx, app, mailer, db, scheduler, exit = process.exit, deadlineMs = SHUTDOWN_DEADLINE_MS }) {
  let stopping = false;

  function force(reason) {
    ctx.log.warn({ reason }, 'shutdown_forced');
    exit(1);
  }

  return async function shutdown(signal) {
    if (stopping) {
      force('second_signal');
      return;
    }
    stopping = true;
    ctx.log.info({ signal }, 'server_stopping');
    const deadline = setTimeout(() => force('deadline'), deadlineMs);
    try {
      ctx.state.stopping = true;
      await scheduler()?.stop();
      await app.close();
      // A failed drain was already logged where it was started.
      await ctx.state.drain?.catch(() => {});
      await mailer.close();
      db.close();
    } catch (err) {
      clearTimeout(deadline);
      ctx.log.error({ code: errorCode(err) }, 'shutdown_error');
      exit(1);
      return;
    }
    clearTimeout(deadline);
    exit(0);
  };
}

// A row left 'sending' by a crash or forced exit was claimed but may never
// have reached the mail server. At startup no drain can be running, so every
// such row is handed back now instead of waiting out the stale window.
export function recoverOutbox(ctx) {
  const count = ctx.repo.requeueAllSending();
  if (count > 0) ctx.log.info({ count }, 'outbox_recovered');
  return count;
}
