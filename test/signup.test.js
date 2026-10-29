import test from 'node:test';
import assert from 'node:assert/strict';
import { closesAt, signupState, signupActive, joins } from '../src/signup.js';
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
  assert.equal(joins({ signup: 'yes' }, 'closed'), true);
  assert.equal(joins({ signup: 'no' }, 'closed'), false);
  assert.equal(joins({ signup: null }, 'closed'), false);
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
