// Field limits and group date rules, shared by the forms, the views'
// maxlength attributes and the event file import, so none of them can accept
// what another refuses. Lengths are in UTF-16 units, as maxlength counts,
// except where a comment says code points.

export const NAME_MAX = 100;
export const PLACE_MAX = 200;
export const THEME_MAX = 2000;
// The whole tick list in its line format.
export const OPTIONS_MAX = 4000;
// Code points.
export const HEADING_MAX = 80;
export const QUESTION_MAX = 80;
// Per form, and per tick list.
export const QUESTIONS_MAX = 15;
export const CHOICES_MAX = 30;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Returns the reason the dates and time are refused, or null. Dates already
// stored (current) may stay as they are, so renaming a group whose dates
// have passed still works.
export function groupDatesError(values, today, current = null) {
  if (values.exchangeTime !== null && !TIME.test(values.exchangeTime)) return 'exchangeTime';
  if (!isDate(values.exchangeDate)) return 'exchangeDate';
  const sameExchange = current && current.exchangeDate === values.exchangeDate;
  if (!sameExchange && values.exchangeDate < today) return 'exchangePast';
  if (values.autoOpenAt !== null) {
    if (!isDate(values.autoOpenAt)) return 'autoOpenAt';
    const unchanged = current && current.autoOpenAt === values.autoOpenAt;
    if (!unchanged && values.autoOpenAt < today) return 'autoOpenPast';
    if (values.autoOpenAt > values.exchangeDate) return 'autoOpenAfter';
  }
  return null;
}

// Returns the reason a sign-up deadline is refused, or null. Answers must be
// in before the first exchange; with no groups yet only the date rules apply.
export function signupDeadlineError(deadline, today, groups) {
  if (!isDate(deadline)) return 'signup-date';
  if (deadline < today) return 'signup-past';
  const first = groups.map((g) => g.exchangeDate).sort()[0];
  if (first !== undefined && deadline >= first) return 'signup-after-exchange';
  return null;
}
