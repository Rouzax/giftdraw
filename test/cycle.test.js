import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PairingError,
  chooseInsertGiver,
  insertIntoCycle,
  makeCycle,
  planRemoval,
  swapReceivers,
  validateAssignment,
} from '../src/draw/cycle.js';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function isSingleCycle(map) {
  const start = map.keys().next().value;
  let cur = map.get(start);
  let steps = 1;
  while (cur !== start) {
    cur = map.get(cur);
    steps += 1;
    if (steps > map.size) return false;
  }
  return steps === map.size;
}

function throwsCode(fn, code) {
  assert.throws(fn, (err) => err instanceof PairingError && err.code === code);
}

test('makeCycle is valid and one cycle for sizes 3..30', () => {
  for (let n = 3; n <= 30; n++) {
    const ids = range(n);
    const map = makeCycle(ids, mulberry32(n));
    assert.equal(validateAssignment(map, ids), true);
    assert.equal(isSingleCycle(map), true);
  }
});

test('makeCycle rejects fewer than 3', () => {
  throwsCode(() => makeCycle([1, 2]), 'too-small');
});

test('makeCycle does not mutate its input', () => {
  const ids = [1, 2, 3, 4];
  makeCycle(ids, mulberry32(1));
  assert.deepEqual(ids, [1, 2, 3, 4]);
});

test('swapReceivers swaps and leaves the input untouched', () => {
  const map = new Map([[1, 2], [2, 3], [3, 4], [4, 1]]);
  const out = swapReceivers(map, 1, 3);
  assert.equal(out.get(1), 4);
  assert.equal(out.get(3), 2);
  assert.equal(map.get(1), 2);
  assert.equal(validateAssignment(out, [1, 2, 3, 4]), true);
});

test('swapReceivers throws self when a giver would get themselves', () => {
  const map = new Map([[1, 2], [2, 3], [3, 1]]);
  throwsCode(() => swapReceivers(map, 1, 2), 'self');
});

test('chooseInsertGiver prefers the given set when non-empty', () => {
  const map = makeCycle(range(6), mulberry32(3));
  const rng = mulberry32(9);
  for (let i = 0; i < 50; i++) {
    assert.ok([2, 5].includes(chooseInsertGiver(map, new Set([2, 5]), rng)));
  }
});

test('chooseInsertGiver falls back to all givers', () => {
  const map = makeCycle(range(4), mulberry32(3));
  const rng = mulberry32(9);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(chooseInsertGiver(map, new Set(), rng));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('insertIntoCycle changes exactly the chosen giver', () => {
  const map = new Map([[1, 2], [2, 3], [3, 1]]);
  const { map: out, changed } = insertIntoCycle(map, 9, 2);
  assert.deepEqual(changed, [2]);
  assert.equal(out.get(2), 9);
  assert.equal(out.get(9), 3);
  assert.equal(out.get(1), 2);
  assert.equal(out.get(3), 1);
  assert.equal(map.size, 3);
  assert.equal(validateAssignment(out, [1, 2, 3, 9]), true);
});

test('planRemoval in a 5-cycle changes only the dropout giver', () => {
  const map = new Map([[1, 2], [2, 3], [3, 4], [4, 5], [5, 1]]);
  const { map: out, changed } = planRemoval(map, 3, new Set(), mulberry32(1));
  assert.deepEqual(changed, [2]);
  assert.equal(out.get(2), 4);
  assert.equal(out.has(3), false);
  assert.equal(validateAssignment(out, [1, 2, 4, 5]), true);
  assert.equal(map.size, 5);
});

test('planRemoval of one side of a two-person loop reinserts the other', () => {
  const map = new Map([[1, 2], [2, 1], [3, 4], [4, 5], [5, 3]]);
  const { map: out, changed } = planRemoval(map, 2, new Set(), mulberry32(4));
  assert.equal(validateAssignment(out, [1, 3, 4, 5]), true);
  assert.equal(changed.length, 2);
  assert.ok(changed.includes(1));
  assert.ok(!changed.includes(2));
  for (const g of changed) assert.notEqual(out.get(g), map.get(g));
});

test('planRemoval leaving fewer than 3 throws too-small', () => {
  const map = new Map([[1, 2], [2, 3], [3, 1]]);
  throwsCode(() => planRemoval(map, 1, new Set(), mulberry32(1)), 'too-small');
});

test('validateAssignment detects self, duplicates and wrong members', () => {
  assert.equal(validateAssignment(new Map([[1, 1], [2, 3], [3, 2]]), [1, 2, 3]), false);
  assert.equal(validateAssignment(new Map([[1, 2], [2, 2], [3, 1]]), [1, 2, 3]), false);
  assert.equal(validateAssignment(new Map([[1, 2], [2, 3], [3, 4]]), [1, 2, 3]), false);
  assert.equal(validateAssignment(new Map([[1, 2], [2, 3]]), [1, 2, 3]), false);
});
