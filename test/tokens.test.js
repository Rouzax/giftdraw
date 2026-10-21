import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken } from '../src/tokens.js';

test('newToken is 43 url-safe chars and unique', () => {
  const a = newToken();
  const b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});
