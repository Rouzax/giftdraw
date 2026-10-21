import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, instantAt, localParts, todayIn } from '../src/time.js';

const AMS = 'Europe/Amsterdam';

test('instantAt handles the spring daylight-saving change', () => {
  assert.equal(instantAt('2026-03-29', '09:00', AMS).toISOString(), '2026-03-29T07:00:00.000Z');
  assert.equal(instantAt('2026-03-28', '09:00', AMS).toISOString(), '2026-03-28T08:00:00.000Z');
  // Just before the switch, where a first guess lands on the summer-time side.
  assert.equal(instantAt('2026-03-29', '01:30', AMS).toISOString(), '2026-03-29T00:30:00.000Z');
});

test('instantAt handles the autumn daylight-saving change', () => {
  assert.equal(instantAt('2026-10-25', '09:00', AMS).toISOString(), '2026-10-25T08:00:00.000Z');
  assert.equal(instantAt('2026-10-24', '09:00', AMS).toISOString(), '2026-10-24T07:00:00.000Z');
});

test('instantAt works in UTC and west of Greenwich', () => {
  assert.equal(instantAt('2026-12-12', '00:00', 'UTC').toISOString(), '2026-12-12T00:00:00.000Z');
  assert.equal(instantAt('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
});

test('todayIn uses the local calendar date', () => {
  assert.equal(todayIn(new Date('2026-12-11T23:30:00Z'), AMS), '2026-12-12');
  assert.equal(todayIn(new Date('2026-12-11T22:30:00Z'), AMS), '2026-12-11');
});

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('localParts gives the wall-clock date and time', () => {
  assert.deepEqual(localParts(new Date('2026-10-25T08:00:30Z'), AMS), { date: '2026-10-25', time: '09:00:30' });
});
