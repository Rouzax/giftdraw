// Codes of mail that cannot go out as queued; sending it again gives up again.
export const SKIP_CODES = Object.freeze([
  'no-participant', 'no-email', 'no-group', 'stale-reminder', 'stale-mail', 'stale-signup', 'no-receiver',
]);
