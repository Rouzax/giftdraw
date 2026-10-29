// The optional sign-up step before the draw. State is derived from the event
// columns and the clock, so it never needs a stored "open" flag to drift.
import { addDays, instantAt, localParts, todayIn } from './time.js';

// The same daytime window as the other reminders.
const SEND_AT = '09:00';
const SEND_UNTIL = '20:00';
const MAX_REMINDERS = 2;
const REMINDER_DAYS = [7, 2];
const NUDGE_DAYS = 2;
const DAY_MS = 86_400_000;

// Answers are accepted through the whole deadline day.
export function closesAt(deadline, tz) {
  return instantAt(addDays(deadline, 1), '00:00', tz);
}

export function signupState(event, now, tz) {
  if (event.signupDoneAt) return 'done';
  if (!event.signupDeadline) return 'off';
  if (!event.signupSentAt) return 'setup';
  if (event.signupClosedAt || now >= closesAt(event.signupDeadline, tz)) return 'closed';
  return 'open';
}

export function signupActive(event, now, tz) {
  return ['setup', 'open', 'closed'].includes(signupState(event, now, tz));
}

// Not answering counts as no, so only an explicit yes joins.
export function joins(participant) {
  return participant.signup === 'yes';
}

// Days left to answer, the deadline day itself included, so it reads 1 on
// the last day.
export function daysLeft(deadline, now, tz) {
  return (Date.parse(deadline) - Date.parse(todayIn(now, tz))) / DAY_MS + 1;
}

// The reminders count every remind-signup the person ever got for this
// event, so moving or reopening the deadline brings new slots but never more
// than two reminders or one nudge.
export function dueSignupMail({ participant, event, history, nudgeHistory, now, tz }) {
  if (signupState(event, now, tz) !== 'open') return null;
  if (!participant.email || !participant.signupInvitedAt) return null;
  const time = localParts(now, tz).time.slice(0, 5);
  if (time < SEND_AT || time >= SEND_UNTIL) return null;

  if (participant.signup === null) {
    if (history.count >= MAX_REMINDERS) return null;
    // Only slots on a later day than the sign-up mail count, also for
    // someone added later: a reminder the morning after being asked, or an
    // hour after it, would chase a question they have only just been given.
    const asked = [event.signupSentAt, participant.signupInvitedAt].map((iso) => localParts(new Date(iso), tz).date);
    const current = REMINDER_DAYS
      .map((days) => addDays(event.signupDeadline, -days))
      .filter((date) => asked.every((day) => date > day))
      .map((date) => instantAt(date, SEND_AT, tz))
      .filter((slot) => slot <= now)
      .at(-1);
    if (!current) return null;
    return !history.lastAt || Date.parse(history.lastAt) < current ? 'remind-signup' : null;
  }
  // Only a no given before the nudge slot gets one; someone who said no
  // later has just made up their mind.
  if (participant.signup === 'no' && nudgeHistory.count === 0) {
    const slot = instantAt(addDays(event.signupDeadline, -NUDGE_DAYS), SEND_AT, tz);
    return now >= slot && Date.parse(participant.signupAt) < slot ? 'signup-nudge' : null;
  }
  return null;
}
