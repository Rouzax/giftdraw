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
