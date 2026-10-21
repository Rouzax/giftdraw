import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/limiter.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

test('allows limit hits per window and refuses the next', () => {
  const limiter = createLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(limiter.hit('a', T0), true);
  assert.equal(limiter.hit('a', T0 + 1), true);
  assert.equal(limiter.hit('a', T0 + 2), true);
  assert.equal(limiter.hit('a', T0 + 3), false);
  assert.equal(limiter.hit('a', T0 + 4), false);
});

test('keys are counted separately', () => {
  const limiter = createLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.hit('a', T0), true);
  assert.equal(limiter.hit('b', T0), true);
  assert.equal(limiter.hit('a', T0), false);
});

test('resets after the window', () => {
  const limiter = createLimiter({ limit: 2, windowMs: 60_000 });
  limiter.hit('a', T0);
  limiter.hit('a', T0);
  assert.equal(limiter.hit('a', T0 + 59_999), false);
  assert.equal(limiter.hit('a', T0 + 60_000), true);
  assert.equal(limiter.hit('a', T0 + 60_001), true);
  assert.equal(limiter.hit('a', T0 + 60_002), false);
});

test('blocked reports a key at the limit without counting', () => {
  const limiter = createLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(limiter.blocked('a', T0), false);
  limiter.hit('a', T0);
  assert.equal(limiter.blocked('a', T0), false);
  limiter.hit('a', T0);
  assert.equal(limiter.blocked('a', T0), true);
  assert.equal(limiter.blocked('a', T0 + 60_000), false);
});

test('expired keys are pruned', () => {
  const limiter = createLimiter({ limit: 2, windowMs: 60_000 });
  for (let i = 0; i < 100; i += 1) limiter.hit(`ip-${i}`, T0);
  assert.equal(limiter.size(), 100);
  limiter.hit('late', T0 + 120_000);
  assert.equal(limiter.size(), 1);
});
