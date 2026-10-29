// The optional sign-up step before the draw. State is derived from the event
// columns and the clock, so it never needs a stored "open" flag to drift.
import { addDays, instantAt } from './time.js';

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
