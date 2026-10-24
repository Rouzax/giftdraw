import { createHash } from 'node:crypto';

const MIN_GROUP = 3;

export function participantScreen({ hasWishes, groupOpen, drawn }) {
  if (drawn) return 'result';
  if (groupOpen) return 'draw';
  return hasWishes ? 'waiting' : 'welcome';
}

const after = (later, earlier) => Boolean(later) && Date.parse(later) > Date.parse(earlier);

// The card shows the receiver's name and wishes (wishesUpdatedAt also
// moves on a rename), the theme, the form and the exchange details.
export function cardOutOfDate(giver, receiver, group, event) {
  if (!giver.printedAt) return false;
  return [receiver?.wishesUpdatedAt, giver.receiverChangedAt, group?.detailsChangedAt, event?.themeChangedAt]
    .some((at) => after(at, giver.printedAt));
}

export function groupWarnings(group, participantCount) {
  const warnings = [];
  if (participantCount === MIN_GROUP) warnings.push('small-group');
  if (participantCount < MIN_GROUP) warnings.push('below-minimum');
  if (group.autoOpenAt && !group.invitationsSentAt) warnings.push('awaiting-invitations');
  return warnings;
}

// Lets a confirm step detect that the assignment or who has drawn changed
// between showing a plan and committing it.
export function assignmentVersion(map, drawnIds) {
  const pairs = [...map].sort((a, b) => a[0] - b[0]);
  const drawn = [...drawnIds].sort((a, b) => a - b);
  return createHash('sha256').update(JSON.stringify({ pairs, drawn })).digest('hex').slice(0, 16);
}
