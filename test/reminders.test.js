import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminder, reminderKind } from '../src/reminders.js';

const tz = 'Europe/Amsterdam';
const NONE = { count: 0, lastAt: null };

const person = (over = {}) => ({
  email: 'ada@example.com',
  invitedAt: '2026-11-02T10:00:00.000Z',
  wishes: null,
  drawnAt: null,
  ...over,
});
const closed = (over = {}) => ({ openedAt: null, autoOpenAt: null, exchangeDate: '2026-12-12', ...over });
const open = (over = {}) => closed({ openedAt: '2026-11-20T15:00:00.000Z', ...over });

function due({ participant = person(), group = closed(), history = NONE, now }) {
  return dueReminder({ participant, group, history, now: new Date(now), tz });
}

test('reminderKind follows state only', () => {
  const wishes = { hobbies: 'lezen', likes: [], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' };
  assert.equal(reminderKind(person(), closed()), 'remind-wishes');
  assert.equal(reminderKind(person({ wishes }), closed()), null);
  assert.equal(reminderKind(person(), open()), 'remind-draw');
  assert.equal(reminderKind(person({ wishes }), open()), 'remind-draw');
  assert.equal(reminderKind(person({ drawnAt: '2026-11-21T10:00:00.000Z' }), open()), null);
});

test('no reminder without email or before the invitation', () => {
  const now = '2026-12-01T08:00:00.000Z';
  assert.equal(due({ participant: person({ email: null }), now }), null);
  assert.equal(due({ participant: person({ invitedAt: null }), now }), null);
  assert.equal(due({ participant: person({ email: null }), group: open(), now }), null);
});

const cases = [
  // Wishes, no auto-open: invitation day plus 5 days at 09:00 (08:00Z in November).
  ['wishes 5 days after invitation, just before', {}, '2026-11-07T07:59:59.000Z', null],
  ['wishes 5 days after invitation, at', {}, '2026-11-07T08:00:00.000Z', 'remind-wishes'],
  // Wishes with auto-open: 3 days before the auto-open date, even though the invitation was long ago.
  ['wishes before auto-open, just before', { group: closed({ autoOpenAt: '2026-11-20' }) }, '2026-11-17T07:59:59.000Z', null],
  ['wishes before auto-open, at', { group: closed({ autoOpenAt: '2026-11-20' }) }, '2026-11-17T08:00:00.000Z', 'remind-wishes'],
  // Second wishes reminder: at least 4 days after the first.
  [
    'second wishes reminder, just before',
    { history: { count: 1, lastAt: '2026-11-07T08:00:00.000Z' } },
    '2026-11-11T07:59:59.000Z',
    null,
  ],
  ['second wishes reminder, at', { history: { count: 1, lastAt: '2026-11-07T08:00:00.000Z' } }, '2026-11-11T08:00:00.000Z', 'remind-wishes'],
  // Spacing is a plain 4 x 24 hours from the last reminder, whatever its time of day.
  [
    'second wishes reminder after an afternoon one, just before',
    { history: { count: 1, lastAt: '2026-11-07T13:00:00.000Z' } },
    '2026-11-11T12:59:59.000Z',
    null,
  ],
  [
    'second wishes reminder after an afternoon one, at',
    { history: { count: 1, lastAt: '2026-11-07T13:00:00.000Z' } },
    '2026-11-11T13:00:00.000Z',
    'remind-wishes',
  ],
  // A late invitation close to auto-open: not before the invitation day plus 3 at 09:00.
  [
    'late invitation, same day',
    { participant: person({ invitedAt: '2026-11-25T10:00:00.000Z' }), group: closed({ autoOpenAt: '2026-11-27' }) },
    '2026-11-25T10:01:00.000Z',
    null,
  ],
  [
    'late invitation, just before 3 days',
    { participant: person({ invitedAt: '2026-11-25T10:00:00.000Z' }), group: closed({ autoOpenAt: '2026-11-30' }) },
    '2026-11-28T07:59:59.000Z',
    null,
  ],
  [
    'late invitation, at 3 days',
    { participant: person({ invitedAt: '2026-11-25T10:00:00.000Z' }), group: closed({ autoOpenAt: '2026-11-30' }) },
    '2026-11-28T08:00:00.000Z',
    'remind-wishes',
  ],
  ['wishes cap of 2', { history: { count: 2, lastAt: '2026-11-07T08:00:00.000Z' } }, '2026-11-30T08:00:00.000Z', null],
  ['no wishes reminder once filled in', { participant: person({ wishes: { avoid: 'noten' } }) }, '2026-11-30T08:00:00.000Z', null],
  // Draw: opened 20 November, first reminder 23 November at 09:00.
  ['first draw reminder, just before', { group: open() }, '2026-11-23T07:59:59.000Z', null],
  ['first draw reminder, at', { group: open() }, '2026-11-23T08:00:00.000Z', 'remind-draw'],
  // Second draw reminder: a week before the exchange date.
  [
    'second draw reminder, just before',
    { group: open(), history: { count: 1, lastAt: '2026-11-23T08:00:00.000Z' } },
    '2026-12-05T07:59:59.000Z',
    null,
  ],
  [
    'second draw reminder, at',
    { group: open(), history: { count: 1, lastAt: '2026-11-23T08:00:00.000Z' } },
    '2026-12-05T08:00:00.000Z',
    'remind-draw',
  ],
  // A first reminder queued at 09:01 does not push the second past exchange minus 7.
  [
    'second draw reminder after a 09:01 first one',
    { group: open(), history: { count: 1, lastAt: '2026-11-23T08:01:00.000Z' } },
    '2026-12-05T08:00:00.000Z',
    'remind-draw',
  ],
  [
    'second draw reminder 3 x 24 hours after a 09:01 first one, just before',
    { group: open(), history: { count: 1, lastAt: '2026-12-04T08:01:00.000Z' } },
    '2026-12-07T08:00:59.000Z',
    null,
  ],
  [
    'second draw reminder 3 x 24 hours after a 09:01 first one, at',
    { group: open(), history: { count: 1, lastAt: '2026-12-04T08:01:00.000Z' } },
    '2026-12-07T08:01:00.000Z',
    'remind-draw',
  ],
  // Second draw reminder also waits 3 days after the first.
  [
    'second draw reminder spacing, just before',
    { group: open(), history: { count: 1, lastAt: '2026-12-04T08:00:00.000Z' } },
    '2026-12-07T07:59:59.000Z',
    null,
  ],
  [
    'second draw reminder spacing, at',
    { group: open(), history: { count: 1, lastAt: '2026-12-04T08:00:00.000Z' } },
    '2026-12-07T08:00:00.000Z',
    'remind-draw',
  ],
  ['draw cap of 2', { group: open(), history: { count: 2, lastAt: '2026-12-05T08:00:00.000Z' } }, '2026-12-10T08:00:00.000Z', null],
  ['no draw reminder once drawn', { group: open(), participant: person({ drawnAt: '2026-11-21T10:00:00.000Z' }) }, '2026-11-30T08:00:00.000Z', null],
  // Nothing is sent from the exchange date on.
  ['no draw reminder on the exchange date', { group: open({ openedAt: '2026-12-08T10:00:00.000Z' }) }, '2026-12-11T23:00:00.000Z', null],
  ['draw reminder the last evening before, at 19:59', { group: open({ openedAt: '2026-12-08T10:00:00.000Z' }) }, '2026-12-11T18:59:59.000Z', 'remind-draw'],
  // Across the October daylight-saving change, 09:00 local is 08:00Z.
  ...[['just before', '2026-10-25T07:59:59.000Z', null], ['at', '2026-10-25T08:00:00.000Z', 'remind-draw']].map(([when, now, expected]) => [
    `draw reminder across DST, ${when}`,
    { group: open({ openedAt: '2026-10-22T10:00:00.000Z' }), participant: person({ invitedAt: '2026-10-15T10:00:00.000Z' }) },
    now,
    expected,
  ]),
  // A late joiner, invited long after the group opened, gets the draw-open
  // mail with the invitation and is not chased on the next tick.
  [
    'late joiner in an open group, a minute after the invitation',
    { participant: person({ invitedAt: '2026-11-25T13:00:00.000Z' }), group: open({ openedAt: '2026-11-01T10:00:00.000Z' }) },
    '2026-11-25T13:01:00.000Z',
    null,
  ],
  [
    'late joiner in an open group, just before 3 days',
    { participant: person({ invitedAt: '2026-11-25T13:00:00.000Z' }), group: open({ openedAt: '2026-11-01T10:00:00.000Z' }) },
    '2026-11-28T07:59:59.000Z',
    null,
  ],
  [
    'late joiner in an open group, at 3 days',
    { participant: person({ invitedAt: '2026-11-25T13:00:00.000Z' }), group: open({ openedAt: '2026-11-01T10:00:00.000Z' }) },
    '2026-11-28T08:00:00.000Z',
    'remind-draw',
  ],
];

for (const [name, input, now, expected] of cases) {
  test(`dueReminder: ${name}`, () => {
    assert.equal(due({ ...input, now }), expected);
  });
}

// Amsterdam is UTC+1 in November: 09:00 local is 08:00Z, 20:00 local 19:00Z.
test('a due reminder goes out only between 09:00 and 20:00 local time and otherwise waits for the morning', () => {
  const at = (now) => due({ now });
  assert.equal(at('2026-11-08T18:59:59.000Z'), 'remind-wishes', '19:59:59');
  assert.equal(at('2026-11-08T19:00:00.000Z'), null, '20:00');
  assert.equal(at('2026-11-08T21:30:00.000Z'), null, '22:30');
  assert.equal(at('2026-11-09T07:59:59.000Z'), null, '08:59:59');
  assert.equal(at('2026-11-09T08:00:00.000Z'), 'remind-wishes', '09:00 the next morning');
});
