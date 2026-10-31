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
  // Only slots on a later day than the sign-up mail count, also for someone
  // added later: a reminder or nudge an hour after being asked would chase a
  // question they have only just been given.
  const asked = [event.signupSentAt, participant.signupInvitedAt].map((iso) => localParts(new Date(iso), tz).date);
  const afterAsked = (date) => asked.every((day) => date > day);

  if (participant.signup === null) {
    if (history.count >= MAX_REMINDERS) return null;
    const current = REMINDER_DAYS
      .map((days) => addDays(event.signupDeadline, -days))
      .filter(afterAsked)
      .map((date) => instantAt(date, SEND_AT, tz))
      .filter((slot) => slot <= now)
      .at(-1);
    if (!current) return null;
    return !history.lastAt || Date.parse(history.lastAt) < current ? 'remind-signup' : null;
  }
  // Only a no given before the nudge slot gets one; someone who said no
  // later has just made up their mind. Any nudge row counts, also one
  // skipped as no longer applying, which the count leaves out.
  if (participant.signup === 'no' && nudgeHistory.lastAt === null) {
    const date = addDays(event.signupDeadline, -NUDGE_DAYS);
    if (!afterAsked(date)) return null;
    const slot = instantAt(date, SEND_AT, tz);
    return now >= slot && Date.parse(participant.signupAt) < slot ? 'signup-nudge' : null;
  }
  return null;
}

// The stored answer as an organiser's set-answer form saw it, so a form from
// before the person (or another page) changed it can be told apart. The time
// is part of it, so an answer changed and changed back still counts as
// changed.
export function answerSeen(participant) {
  return `${participant.signup ?? ''}@${participant.signupAt ?? ''}`;
}

// The day a closed sign-up closed: the day the organiser closed it by hand,
// or else the deadline. The scheduler also stamps signupClosedAt, at its first
// tick after the deadline ran out, which falls on the day after; only a stamp
// from before then is a close by hand.
export function closedOn(event, tz) {
  const byHand = event.signupClosedAt && new Date(event.signupClosedAt) < closesAt(event.signupDeadline, tz);
  return byHand ? todayIn(new Date(event.signupClosedAt), tz) : event.signupDeadline;
}
