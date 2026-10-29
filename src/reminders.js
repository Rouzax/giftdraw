import { hasWishes } from './answers.js';
import { wishForm } from './questions.js';
import { addDays, instantAt, localParts } from './time.js';

// Reminders become due at 09:00 and go out only in the daytime: one that
// becomes due later (spacing, a cleared answer, an app that was down in the
// morning) waits for the next 09:00 instead of arriving in the night.
const SEND_AT = '09:00';
const SEND_UNTIL = '20:00';
const DAY_MS = 86_400_000;
const MAX_PER_KIND = 2;
const WISHES_SPACING_DAYS = 4;
const DRAW_SPACING_DAYS = 3;

// form is the event's wishForm. With no question shown there is nothing to
// ask for, and answers to hidden questions do not count as given.
export function reminderKind(participant, group, form = wishForm({})) {
  if (group.openedAt) return participant.drawnAt ? null : 'remind-draw';
  if (!form.questions.some((question) => question.show)) return null;
  return hasWishes(participant.wishes, form) ? null : 'remind-wishes';
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

export function dueReminder({ participant, group, form, history, now, tz }) {
  if (!participant.email || !participant.invitedAt) return null;
  const kind = reminderKind(participant, group, form);
  if (!kind || history.count >= MAX_PER_KIND) return null;
  // Nothing is sent from the exchange date on.
  if (now >= instantAt(group.exchangeDate, '00:00', tz)) return null;
  const time = localParts(now, tz).time.slice(0, 5);
  if (time < SEND_AT || time >= SEND_UNTIL) return null;

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
