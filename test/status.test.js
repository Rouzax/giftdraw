import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentVersion, cardOutOfDate, groupWarnings, participantScreen } from '../src/status.js';

test('participantScreen picks the one screen for each state', () => {
  assert.equal(participantScreen({ hasWishes: false, groupOpen: false, drawn: false }), 'welcome');
  assert.equal(participantScreen({ hasWishes: true, groupOpen: false, drawn: false }), 'waiting');
  assert.equal(participantScreen({ hasWishes: false, groupOpen: true, drawn: false }), 'draw');
  assert.equal(participantScreen({ hasWishes: true, groupOpen: true, drawn: false }), 'draw');
  assert.equal(participantScreen({ hasWishes: false, groupOpen: true, drawn: true }), 'result');
});

test('cardOutOfDate is false without a print', () => {
  const giver = { printedAt: null, receiverChangedAt: '2026-11-02T10:00:00.000Z' };
  assert.equal(cardOutOfDate(giver, { wishesUpdatedAt: '2026-11-03T10:00:00.000Z' }), false);
});

test('cardOutOfDate is false when printed after every change', () => {
  const giver = { printedAt: '2026-11-05T10:00:00.000Z', receiverChangedAt: '2026-11-02T10:00:00.000Z' };
  assert.equal(cardOutOfDate(giver, { wishesUpdatedAt: '2026-11-03T10:00:00.000Z' }), false);
  assert.equal(cardOutOfDate(giver, { wishesUpdatedAt: null }), false);
});

test('cardOutOfDate is true when the receiver changed wishes after the print', () => {
  const giver = { printedAt: '2026-11-05T10:00:00.000Z', receiverChangedAt: '2026-11-02T10:00:00.000Z' };
  assert.equal(cardOutOfDate(giver, { wishesUpdatedAt: '2026-11-05T10:00:01.000Z' }), true);
});

test('cardOutOfDate is true when the giver got a new receiver after the print', () => {
  const giver = { printedAt: '2026-11-05T10:00:00.000Z', receiverChangedAt: '2026-11-06T10:00:00.000Z' };
  assert.equal(cardOutOfDate(giver, { wishesUpdatedAt: null }), true);
});

test('cardOutOfDate is true when the exchange details or the theme changed after the print', () => {
  const giver = { printedAt: '2026-11-05T10:00:00.000Z', receiverChangedAt: '2026-11-02T10:00:00.000Z' };
  const receiver = { wishesUpdatedAt: null };
  const before = '2026-11-04T10:00:00.000Z';
  const after = '2026-11-05T10:00:01.000Z';
  assert.equal(cardOutOfDate(giver, receiver, { detailsChangedAt: before }, { themeChangedAt: before }), false);
  assert.equal(cardOutOfDate(giver, receiver, { detailsChangedAt: null }, { themeChangedAt: null }), false);
  assert.equal(cardOutOfDate(giver, receiver, { detailsChangedAt: after }, { themeChangedAt: null }), true);
  assert.equal(cardOutOfDate(giver, receiver, { detailsChangedAt: null }, { themeChangedAt: after }), true);
  assert.equal(cardOutOfDate({ ...giver, printedAt: null }, receiver, { detailsChangedAt: after }, { themeChangedAt: after }), false);
});

test('groupWarnings', () => {
  const sent = { autoOpenAt: '2026-12-01', invitationsSentAt: '2026-11-01T10:00:00.000Z' };
  const unsent = { autoOpenAt: '2026-12-01', invitationsSentAt: null };
  const manual = { autoOpenAt: null, invitationsSentAt: null };
  assert.deepEqual(groupWarnings(sent, 4), []);
  assert.deepEqual(groupWarnings(manual, 4), []);
  assert.deepEqual(groupWarnings(sent, 3), ['small-group']);
  assert.deepEqual(groupWarnings(sent, 2), ['below-minimum']);
  assert.deepEqual(groupWarnings(sent, 0), ['below-minimum']);
  assert.deepEqual(groupWarnings(unsent, 3), ['small-group', 'awaiting-invitations']);
});

test('assignmentVersion is stable and independent of insertion order', () => {
  const a = new Map([[1, 2], [2, 3], [3, 1]]);
  const b = new Map([[3, 1], [1, 2], [2, 3]]);
  assert.equal(assignmentVersion(a, [1, 3]), assignmentVersion(b, [3, 1]));
  assert.match(assignmentVersion(a, []), /^[0-9a-f]{16}$/);
});

test('assignmentVersion changes when a pair or the drawn set changes', () => {
  const base = new Map([[1, 2], [2, 3], [3, 1], [4, 5], [5, 4]]);
  const swapped = new Map([[1, 3], [2, 1], [3, 2], [4, 5], [5, 4]]);
  const v = assignmentVersion(base, [1]);
  assert.notEqual(assignmentVersion(swapped, [1]), v);
  assert.notEqual(assignmentVersion(base, [1, 2]), v);
  assert.notEqual(assignmentVersion(base, []), v);
});
