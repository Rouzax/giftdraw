import { performance } from 'node:perf_hooks';
import { openGroup } from './drawing.js';
import { drainOutbox, errorCode } from './mail/outbox.js';
import { enqueueMail, mailOn } from './people.js';
import { dueReminder, reminderKind } from './reminders.js';
import { instantAt, todayIn } from './time.js';

const AUTO_OPEN_AT = '09:00';
const STALE_SENDING_MS = 10 * 60_000;

// One bad row is logged and skipped so it cannot hold up everyone after it.
function eachRow(ctx, step, rows, idField, fn) {
  let count = 0;
  for (const row of rows) {
    try {
      if (fn(row)) count += 1;
    } catch (err) {
      ctx.log.error({ step, [idField]: row.id, code: errorCode(err) }, 'tick_row_error');
    }
  }
  return count;
}

function autoOpen(ctx, now) {
  const { repo, config } = ctx;
  const groups = repo.listEvents().flatMap((event) => repo.listGroups(event.id));
  const due = groups.filter((g) => !g.openedAt && g.autoOpenAt && g.invitationsSentAt);
  return eachRow(ctx, 'auto-open', due, 'group_id', (group) => {
    if (now < instantAt(group.autoOpenAt, AUTO_OPEN_AT, config.tz)) return false;
    const { opened } = openGroup(ctx, group.id);
    if (opened) ctx.log.info({ group_id: group.id }, 'group_auto_opened');
    return opened;
  });
}

function reminders(ctx, now) {
  const { repo, config } = ctx;
  if (!mailOn(ctx)) return 0;
  const groups = new Map();
  return eachRow(ctx, 'reminders', repo.listAllParticipants(), 'participant_id', (participant) => {
    if (!groups.has(participant.groupId)) groups.set(participant.groupId, repo.getGroup(participant.groupId));
    const group = groups.get(participant.groupId);
    if (!group) return false;
    const kind = reminderKind(participant, group);
    if (!kind) return false;
    const history = repo.reminderHistory(participant.id, kind);
    const due = dueReminder({ participant, group, history, now, tz: config.tz });
    return due ? enqueueMail(ctx, participant.id, due, now.toISOString()) : false;
  });
}

// The giver is looked up again here, not when the wishes were saved: the
// pairing can change in between, and a giver who has not drawn yet sees the
// wishes when they draw.
function wishUpdates(ctx, now) {
  const { repo } = ctx;
  const nowIso = now.toISOString();
  const due = repo.listAllParticipants().filter((p) => p.notifyGiverDueAt && p.notifyGiverDueAt <= nowIso);
  return eachRow(ctx, 'wish-updates', due, 'participant_id', (participant) =>
    repo.tx(() => {
      const current = repo.getParticipant(participant.id);
      if (!current?.notifyGiverDueAt || current.notifyGiverDueAt > nowIso) return false;
      repo.updateParticipant(current.id, { notifyGiverDueAt: null });
      const giver = repo.giverOf(current.id);
      if (!giver?.drawnAt || !giver.email) return false;
      return enqueueMail(ctx, giver.id, 'wishes-updated', nowIso);
    }));
}

function cleanup(ctx, now) {
  const { repo, config } = ctx;
  const deleted = repo.deleteExpiredGroups(todayIn(now, config.tz));
  if (deleted > 0) {
    // Truncating the WAL keeps deleted participant data out of the log file.
    repo.checkpoint();
    ctx.log.info({ count: deleted }, 'groups_cleaned');
  }
  return deleted;
}

export async function tick(ctx) {
  const started = performance.now();
  const now = ctx.now();
  const result = { opened: 0, reminders: 0, wishUpdates: 0, deleted: 0 };
  let outcome = 'error';
  try {
    result.opened = autoOpen(ctx, now);
    result.reminders = reminders(ctx, now);
    result.wishUpdates = wishUpdates(ctx, now);
    result.deleted = cleanup(ctx, now);
    ctx.repo.requeueStale(new Date(now.getTime() - STALE_SENDING_MS).toISOString());
    await drainOutbox(ctx);
    outcome = 'success';
    return result;
  } finally {
    ctx.log.debug(
      {
        opened: result.opened,
        reminders: result.reminders,
        wish_updates: result.wishUpdates,
        deleted: result.deleted,
        duration_ms: Math.round(performance.now() - started),
        outcome,
      },
      'tick_done',
    );
  }
}

// The next tick is scheduled only once the previous one has settled, so a
// slow mail server can never make two ticks overlap.
export function startScheduler(ctx, intervalMs = 60_000) {
  let timer = null;
  let running = null;
  let stopped = false;

  function run() {
    timer = null;
    running = tick(ctx)
      .catch((err) => ctx.log.error({ code: errorCode(err) }, 'tick_error'))
      .finally(() => {
        running = null;
        if (!stopped) timer = setTimeout(run, intervalMs);
      });
  }

  run();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running;
    },
  };
}
