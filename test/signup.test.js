import test from 'node:test';
import assert from 'node:assert/strict';
import { closesAt, daysLeft, dueSignupMail, signupState, signupActive, joins } from '../src/signup.js';
import { signupDeadlineError } from '../src/limits.js';
import { makeTestApp, seedGroup } from './helpers.js';

const TZ = 'Europe/Amsterdam';
const base = { signupDeadline: '2026-12-01', signupSentAt: '2026-11-01T10:00:00.000Z', signupClosedAt: null, signupDoneAt: null };
const before = new Date('2026-12-01T22:59:59.000Z');
const at = new Date('2026-12-01T23:00:00.000Z');

test('closesAt is the start of the day after the deadline, local', () => {
  assert.equal(closesAt('2026-12-01', TZ).toISOString(), '2026-12-01T23:00:00.000Z');
  assert.equal(closesAt('2026-07-31', TZ).toISOString(), '2026-07-31T22:00:00.000Z');
});

test('signupState', () => {
  assert.equal(signupState({ ...base, signupDeadline: null }, before, TZ), 'off');
  assert.equal(signupState({ ...base, signupSentAt: null }, before, TZ), 'setup');
  assert.equal(signupState(base, before, TZ), 'open');
  assert.equal(signupState(base, at, TZ), 'closed');
  assert.equal(signupState({ ...base, signupClosedAt: '2026-11-20T10:00:00.000Z' }, before, TZ), 'closed');
  assert.equal(signupState({ ...base, signupDoneAt: 'x' }, before, TZ), 'done');
  assert.equal(signupState({ ...base, signupDoneAt: 'x', signupDeadline: null, signupSentAt: null }, at, TZ), 'done');
});

test('signupActive covers setup, open and closed only', () => {
  assert.equal(signupActive({ ...base, signupDeadline: null }, before, TZ), false);
  assert.equal(signupActive({ ...base, signupSentAt: null }, before, TZ), true);
  assert.equal(signupActive(base, before, TZ), true);
  assert.equal(signupActive(base, at, TZ), true);
  assert.equal(signupActive({ ...base, signupDoneAt: 'x' }, at, TZ), false);
});

test('joins counts only yes', () => {
  assert.equal(joins({ signup: 'yes' }), true);
  assert.equal(joins({ signup: 'no' }), false);
  assert.equal(joins({ signup: null }), false);
});

test('signupDeadlineError', () => {
  const groups = [{ exchangeDate: '2026-12-18' }, { exchangeDate: '2026-12-10' }];
  assert.equal(signupDeadlineError('2026-12-09', '2026-11-01', groups), null);
  assert.equal(signupDeadlineError('2026-11-01', '2026-11-01', groups), null);
  assert.equal(signupDeadlineError('nope', '2026-11-01', groups), 'signup-date');
  assert.equal(signupDeadlineError('2026-02-30', '2026-11-01', groups), 'signup-date');
  assert.equal(signupDeadlineError('2026-10-31', '2026-11-01', groups), 'signup-past');
  assert.equal(signupDeadlineError('2026-12-10', '2026-11-01', groups), 'signup-after-exchange');
  assert.equal(signupDeadlineError('2027-01-01', '2026-11-01', []), null);
  const opening = [{ exchangeDate: '2026-12-18', autoOpenAt: '2026-12-01' }, { exchangeDate: '2026-12-18', autoOpenAt: null }];
  assert.equal(signupDeadlineError('2026-11-30', '2026-11-01', opening), null);
  assert.equal(signupDeadlineError('2026-12-01', '2026-11-01', opening), 'signup-after-auto-open');
  assert.equal(signupDeadlineError('2026-12-05', '2026-11-01', opening), 'signup-after-auto-open');
});

test('the repo stores sign-up fields without moving card timestamps', async (t) => {
  const app = await makeTestApp({ clock: () => new Date('2026-11-01T10:00:00Z') });
  t.after(() => app.app.close());
  const { repo } = app.ctx;
  const ctx = app.ctx;
  const { event, people } = seedGroup(ctx, { names: ['Ann', 'Bob', 'Cy'] });
  repo.updateEvent(event.id, { signupDeadline: '2026-12-01', signupSentAt: 's' });
  const e = repo.getEvent(event.id);
  assert.equal(e.signupDeadline, '2026-12-01');
  assert.equal(e.themeChangedAt, event.themeChangedAt);
  repo.updateParticipant(people[0].id, { signup: 'yes', signupAt: 'a', signupInvitedAt: 'i' });
  const p = repo.getParticipant(people[0].id);
  assert.deepEqual([p.signup, p.signupAt, p.signupInvitedAt], ['yes', 'a', 'i']);
  assert.throws(() => repo.updateParticipant(people[0].id, { signup: 'maybe' }));
  assert.deepEqual(repo.listSignupEvents().map((x) => x.id), [event.id]);
  repo.updateEvent(event.id, { signupClosedAt: 'c' });
  assert.deepEqual(repo.listSignupEvents(), []);
});

// Deadline Friday 20 November; 09:00 Amsterdam is 08:00Z in winter, so the
// reminder slots are 13 November (deadline-7) and 18 November (deadline-2).
const OPEN = { signupDeadline: '2026-11-20', signupSentAt: '2026-11-10T10:00:00.000Z', signupClosedAt: null, signupDoneAt: null };
const ASKED = { email: 'ada@example.com', signup: null, signupAt: null, signupInvitedAt: '2026-11-10T10:00:00.000Z' };
const NONE = { count: 0, lastAt: null };
const ONE = { count: 1, lastAt: '2026-11-13T08:00:30.000Z' };
const TWO = { count: 2, lastAt: '2026-11-18T08:00:30.000Z' };
const SAID_NO = { ...ASKED, signup: 'no', signupAt: '2026-11-15T12:00:00.000Z' };
const DST = {
  event: { signupDeadline: '2027-04-02', signupSentAt: '2027-03-20T10:00:00.000Z' },
  participant: { signupInvitedAt: '2027-03-20T10:00:00.000Z' },
};

const DUE = [
  ['nothing on deadline-8', {}, '2026-11-12T08:00:00.000Z', NONE, NONE, null],
  ['nothing at 08:59 on deadline-7', {}, '2026-11-13T07:59:00.000Z', NONE, NONE, null],
  ['a reminder at 09:00 on deadline-7', {}, '2026-11-13T08:00:00.000Z', NONE, NONE, 'remind-signup'],
  ['nothing again that day', {}, '2026-11-13T12:00:00.000Z', ONE, NONE, null],
  ['a reminder at 09:00 on deadline-2', {}, '2026-11-18T08:00:00.000Z', ONE, NONE, 'remind-signup'],
  ['nothing at 20:00', {}, '2026-11-18T19:00:00.000Z', ONE, NONE, null],
  ['nothing on deadline-1 after both', {}, '2026-11-19T08:00:00.000Z', TWO, NONE, null],
  ['a missed morning is caught up later that day', {}, '2026-11-13T15:00:00.000Z', NONE, NONE, 'remind-signup'],
  ['never a third', {}, '2026-11-18T08:00:00.000Z', { count: 2, lastAt: '2026-11-13T08:00:30.000Z' }, NONE, null],
  ['sent 4 days before: nothing for the skipped first slot',
    { event: { signupSentAt: '2026-11-16T10:00:00.000Z' }, participant: { signupInvitedAt: '2026-11-16T10:00:00.000Z' } },
    '2026-11-16T12:00:00.000Z', NONE, NONE, null],
  ['sent 4 days before: one reminder at deadline-2',
    { event: { signupSentAt: '2026-11-16T10:00:00.000Z' }, participant: { signupInvitedAt: '2026-11-16T10:00:00.000Z' } },
    '2026-11-18T08:00:00.000Z', NONE, NONE, 'remind-signup'],
  ['sent 4 days before: nothing after that one',
    { event: { signupSentAt: '2026-11-16T10:00:00.000Z' }, participant: { signupInvitedAt: '2026-11-16T10:00:00.000Z' } },
    '2026-11-19T08:00:00.000Z', { count: 1, lastAt: '2026-11-18T08:00:30.000Z' }, NONE, null],
  ['someone added between the slots is not chased by the earlier one',
    { participant: { signupInvitedAt: '2026-11-14T10:00:00.000Z' } }, '2026-11-15T08:00:00.000Z', NONE, NONE, null],
  ['someone added between the slots gets the later one',
    { participant: { signupInvitedAt: '2026-11-14T10:00:00.000Z' } }, '2026-11-18T08:00:00.000Z', NONE, NONE, 'remind-signup'],
  ['someone added at 08:30 on a slot day is not reminded at 09:00',
    { participant: { signupInvitedAt: '2026-11-18T07:30:00.000Z' } }, '2026-11-18T08:00:00.000Z', NONE, NONE, null],
  ['sent at 08:30 on deadline-7: no reminder at 09:00 that day',
    { event: { signupSentAt: '2026-11-13T07:30:00.000Z' }, participant: { signupInvitedAt: '2026-11-13T07:30:00.000Z' } },
    '2026-11-13T08:00:00.000Z', NONE, NONE, null],
  ['answered yes: nothing', { participant: { signup: 'yes', signupAt: '2026-11-11T10:00:00.000Z' } },
    '2026-11-13T08:00:00.000Z', NONE, NONE, null],
  ['answered no: no reminder', { participant: SAID_NO }, '2026-11-13T08:00:00.000Z', NONE, NONE, null],
  ['answered no: no nudge at 08:59 on deadline-2', { participant: SAID_NO }, '2026-11-18T07:59:00.000Z', NONE, NONE, null],
  ['answered no: a nudge at 09:00 on deadline-2', { participant: SAID_NO }, '2026-11-18T08:00:00.000Z', NONE, NONE, 'signup-nudge'],
  ['answered no: never a second nudge', { participant: SAID_NO }, '2026-11-19T08:00:00.000Z', NONE, { count: 1, lastAt: 'x' }, null],
  ['answered no: no new nudge after one that gave up', { participant: SAID_NO }, '2026-11-19T08:00:00.000Z', NONE,
    { count: 0, lastAt: '2026-11-18T08:00:30.000Z' }, null],
  ['answered no after 09:00 on deadline-2: no nudge',
    { participant: { ...SAID_NO, signupAt: '2026-11-18T08:30:00.000Z' } }, '2026-11-18T10:00:00.000Z', NONE, NONE, null],
  ['sent at 08:30 on deadline-2 to someone who said no at once: no nudge at 09:00',
    { event: { signupSentAt: '2026-11-18T07:30:00.000Z' },
      participant: { ...SAID_NO, signupInvitedAt: '2026-11-18T07:30:00.000Z', signupAt: '2026-11-18T07:45:00.000Z' } },
    '2026-11-18T08:00:00.000Z', NONE, NONE, null],
  ['added at 08:30 on deadline-2 and said no at once: no nudge at 09:00',
    { participant: { ...SAID_NO, signupInvitedAt: '2026-11-18T07:30:00.000Z', signupAt: '2026-11-18T07:45:00.000Z' } },
    '2026-11-18T08:00:00.000Z', NONE, NONE, null],
  ['asked the day before deadline-2 and said no: a nudge at 09:00',
    { participant: { ...SAID_NO, signupInvitedAt: '2026-11-17T10:00:00.000Z', signupAt: '2026-11-17T12:00:00.000Z' } },
    '2026-11-18T08:00:00.000Z', NONE, NONE, 'signup-nudge'],
  // Summer time starts on 28 March 2027: 09:00 Amsterdam is 08:00Z on
  // deadline-7 (26 March) and 07:00Z on deadline-2 (31 March).
  ['across summer time: nothing at 07:59Z on deadline-7', DST, '2027-03-26T07:59:00.000Z', NONE, NONE, null],
  ['across summer time: a reminder at 08:00Z on deadline-7', DST, '2027-03-26T08:00:00.000Z', NONE, NONE, 'remind-signup'],
  ['across summer time: nothing at 06:59Z on deadline-2', DST, '2027-03-31T06:59:00.000Z',
    { count: 1, lastAt: '2027-03-26T08:00:30.000Z' }, NONE, null],
  ['across summer time: a reminder at 07:00Z on deadline-2', DST, '2027-03-31T07:00:00.000Z',
    { count: 1, lastAt: '2027-03-26T08:00:30.000Z' }, NONE, 'remind-signup'],
  ['closed: nothing', { event: { signupClosedAt: '2026-11-12T10:00:00.000Z' } }, '2026-11-13T08:00:00.000Z', NONE, NONE, null],
  ['closed: no nudge', { event: { signupClosedAt: '2026-11-17T10:00:00.000Z' }, participant: SAID_NO },
    '2026-11-18T08:00:00.000Z', NONE, NONE, null],
  ['no email: nothing', { participant: { email: null } }, '2026-11-13T08:00:00.000Z', NONE, NONE, null],
  ['never asked: nothing', { participant: { signupInvitedAt: null } }, '2026-11-13T08:00:00.000Z', NONE, NONE, null],
];

for (const [name, change, at, history, nudgeHistory, want] of DUE) {
  test(`dueSignupMail: ${name}`, () => {
    const got = dueSignupMail({
      participant: { ...ASKED, ...change.participant },
      event: { ...OPEN, ...change.event },
      history,
      nudgeHistory,
      now: new Date(at),
      tz: TZ,
    });
    assert.equal(got, want);
  });
}

test('daysLeft counts whole days until the closing day, which itself is 0', () => {
  assert.equal(daysLeft('2026-11-20', new Date('2026-11-13T08:00:00.000Z'), TZ), 7);
  assert.equal(daysLeft('2026-11-20', new Date('2026-11-18T08:00:00.000Z'), TZ), 2);
  assert.equal(daysLeft('2026-11-20', new Date('2026-11-19T08:00:00.000Z'), TZ), 1);
  assert.equal(daysLeft('2026-11-20', new Date('2026-11-20T22:59:00.000Z'), TZ), 0);
  // Local midnight, not UTC: 23:30Z on the 19th is already the 20th in Amsterdam.
  assert.equal(daysLeft('2026-11-20', new Date('2026-11-19T23:30:00.000Z'), TZ), 0);
});
