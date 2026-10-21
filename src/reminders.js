import { addDays, instantAt, localParts } from './time.js';
import { hasWishes } from './wishes.js';

// Reminders go out in the morning, never in the middle of the night.
const SEND_AT = '09:00';
const DAY_MS = 86_400_000;
const MAX_PER_KIND = 2;
const WISHES_SPACING_DAYS = 4;
const DRAW_SPACING_DAYS = 3;

export function reminderKind(participant, group) {
  if (group.openedAt) return participant.drawnAt ? null : 'remind-draw';
  return hasWishes(participant.wishes) ? null : 'remind-wishes';
}

function morningAfter(iso, days, tz) {
  return instantAt(addDays(localParts(new Date(iso), tz).date, days), SEND_AT, tz);
}

// A plain duration rather than a 09:00 threshold: queued reminders are
// created a little after 09:00, and rounding up to the next morning would add
// a day and could push the second draw reminder past the exchange date.
function spacedAfter(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS);
}

export function dueReminder({ participant, group, history, now, tz }) {
  if (!participant.email || !participant.invitedAt) return null;
  const kind = reminderKind(participant, group);
  if (!kind || history.count >= MAX_PER_KIND) return null;
  // Nothing is sent from the exchange date on.
  if (now >= instantAt(group.exchangeDate, '00:00', tz)) return null;

  // A late invitation, close to auto-open or into an open group, must not be
  // chased by a reminder on the next scheduler tick.
  const notBefore = [morningAfter(participant.invitedAt, 3, tz)];
  if (kind === 'remind-wishes') {
    notBefore.push(
      group.autoOpenAt
        ? instantAt(addDays(group.autoOpenAt, -3), SEND_AT, tz)
        : morningAfter(participant.invitedAt, 5, tz),
    );
    if (history.lastAt) notBefore.push(spacedAfter(history.lastAt, WISHES_SPACING_DAYS));
  } else {
    notBefore.push(
      history.count === 0
        ? morningAfter(group.openedAt, 3, tz)
        : instantAt(addDays(group.exchangeDate, -7), SEND_AT, tz),
    );
    if (history.lastAt) notBefore.push(spacedAfter(history.lastAt, DRAW_SPACING_DAYS));
  }
  return notBefore.every((at) => now >= at) ? kind : null;
}
