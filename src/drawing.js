import { PairingError, swapReceivers, validateAssignment } from './draw/cycle.js';
import { kickDrain } from './mail/outbox.js';
import { enqueueMail, mailOn } from './people.js';
import { assignmentVersion } from './status.js';

const MIN_GROUP = 3;

// What the arrange page shows and a swap must match: the pairing and who has
// drawn, read in one go.
export function arrangeState(repo, groupId) {
  const people = repo.listParticipants(groupId);
  const map = repo.getAssignment(groupId);
  const version = assignmentVersion(map, people.filter((p) => p.drawnAt).map((p) => p.id));
  return { people, map, version };
}

// Returns {swapped: true} or {error: 'unknown' | 'drawn' | 'stale' | 'self'}.
// Only givers who have not drawn can swap, so nobody's revealed receiver
// changes and no mail is needed.
export function swapPair(ctx, groupId, a, b, version) {
  const { repo } = ctx;
  return repo.tx(() => {
    const { people, map, version: current } = arrangeState(repo, groupId);
    const byId = new Map(people.map((p) => [p.id, p]));
    if (a === b || !map.has(a) || !map.has(b) || !byId.has(a) || !byId.has(b)) return { error: 'unknown' };
    if (byId.get(a).drawnAt || byId.get(b).drawnAt) return { error: 'drawn' };
    if (version !== current) return { error: 'stale' };
    let next;
    try {
      next = swapReceivers(map, a, b);
    } catch (err) {
      if (err instanceof PairingError) return { error: 'self' };
      throw err;
    }
    repo.setAssignment(groupId, next, ctx.nowIso());
    return { swapped: true };
  });
}

// markGroupOpened is conditional, so of two overlapping calls (a double
// press, or a press racing the auto-open date) only one queues the mails.
export function openGroup(ctx, groupId) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  const result = repo.tx(() => {
    const group = repo.getGroup(groupId);
    // The scheduler can reach a group that was deleted in the meantime.
    if (!group) return { opened: false, reason: 'invalid' };
    if (group.openedAt) return { opened: false, reason: 'already-open' };
    if (!group.invitationsSentAt) return { opened: false, reason: 'no-invitations' };
    const people = repo.listParticipants(groupId);
    if (people.length < MIN_GROUP) return { opened: false, reason: 'too-small' };
    if (!validateAssignment(repo.getAssignment(groupId), people.map((p) => p.id))) return { opened: false, reason: 'invalid' };
    if (!repo.markGroupOpened(groupId, now)) return { opened: false, reason: 'already-open' };
    let queued = 0;
    for (const p of people) {
      if (!p.email || !mailOn(ctx)) continue;
      // An address added after the invitations went out was never mailed:
      // the invitation goes first, and it starts that person's reminders.
      if (!p.invitedAt) {
        repo.updateParticipant(p.id, { invitedAt: now });
        enqueueMail(ctx, p.id, 'invite', now);
        queued += 1;
      }
      enqueueMail(ctx, p.id, 'draw-open', now);
      queued += 1;
    }
    return { opened: true, queued };
  });
  if (!result.opened) return result;
  ctx.log.info({ group_id: groupId, queued: result.queued }, 'group_opened');
  if (result.queued) kickDrain(ctx);
  return { opened: true };
}
