import { parseWishesForm, wishOptions } from './wishes.js';

export function saveWishes(ctx, participantId, body) {
  const { repo } = ctx;
  return repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    const event = repo.getEvent(repo.getGroup(participant.groupId).eventId);
    const wishes = parseWishesForm(body, wishOptions(event));
    repo.updateParticipant(participantId, { wishes, wishesUpdatedAt: ctx.nowIso() });
    return wishes;
  });
}

// The assignment is fixed beforehand, so drawing only reveals it. drawnAt is
// set once, by the first reveal, and later calls just look the receiver up.
export function drawFor(ctx, participantId) {
  const { repo } = ctx;
  return repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    if (!repo.getGroup(participant.groupId).openedAt) throw new Error('drawFor: group is not open');
    const receiver = participant.receiverId ? repo.getParticipant(participant.receiverId) : null;
    if (!receiver) throw new Error('drawFor: participant has no receiver');
    const firstTime = !participant.drawnAt;
    if (firstTime) repo.updateParticipant(participantId, { drawnAt: ctx.nowIso() });
    return { receiver, firstTime };
  });
}
