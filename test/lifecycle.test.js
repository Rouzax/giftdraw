import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createShutdown, recoverOutbox } from '../src/lifecycle.js';
import { makeTestApp, seedGroup } from './helpers.js';

// Every step records itself; `hang` names a step that never settles, the way
// a send to an unresponsive mail server does.
function fakeParts({ hang = null } = {}) {
  const calls = [];
  const exits = [];
  const step = (name) => () => {
    calls.push(name);
    return name === hang ? new Promise(() => {}) : Promise.resolve();
  };
  const ctx = {
    state: { drain: null },
    log: { info: () => {}, warn: (fields, msg) => calls.push(msg), error: (fields, msg) => calls.push(msg) },
  };
  return {
    calls,
    exits,
    parts: {
      ctx,
      app: { close: step('app') },
      mailer: { close: step('mailer') },
      db: { close: () => calls.push('db') },
      scheduler: () => ({ stop: step('scheduler') }),
      exit: (code) => exits.push(code),
    },
  };
}

test('shutdown closes everything in order and exits 0', async () => {
  const { calls, exits, parts } = fakeParts();
  await createShutdown(parts)('SIGTERM');
  assert.deepEqual(calls, ['scheduler', 'app', 'mailer', 'db']);
  assert.deepEqual(exits, [0]);
  assert.equal(parts.ctx.state.stopping, true);
});

test('a second signal during a hung shutdown forces exit 1', async () => {
  const { calls, exits, parts } = fakeParts({ hang: 'mailer' });
  const shutdown = createShutdown(parts);
  shutdown('SIGTERM');
  await wait(5);
  assert.deepEqual(exits, []);
  shutdown('SIGTERM');
  assert.deepEqual(exits, [1]);
  assert.ok(calls.includes('shutdown_forced'));
  assert.ok(!calls.includes('db'));
});

test('a hung shutdown is forced to exit 1 after the deadline', async () => {
  const { calls, exits, parts } = fakeParts({ hang: 'mailer' });
  createShutdown({ ...parts, deadlineMs: 20 })('SIGTERM');
  await wait(60);
  assert.deepEqual(exits, [1]);
  assert.ok(calls.includes('shutdown_forced'));
});

test('a failing step exits 1', async () => {
  const { exits, parts } = fakeParts();
  parts.app.close = () => Promise.reject(new Error('boom'));
  await createShutdown(parts)('SIGINT');
  assert.deepEqual(exits, [1]);
});

test('recoverOutbox hands every sending row back and logs the count', async () => {
  const { ctx, logs, db } = await makeTestApp();
  const { people } = seedGroup(ctx, { names: ['Ada', 'Ben', 'Cor'] });
  ctx.repo.enqueue(people[0].id, 'invite', ctx.nowIso());
  ctx.repo.claimDue(ctx.nowIso(), 10);
  assert.equal(recoverOutbox(ctx), 1);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM outbox WHERE status = 'sending'`).get().n, 0);
  const entry = logs.map((line) => JSON.parse(line)).find((l) => l.msg === 'outbox_recovered');
  assert.equal(entry.count, 1);
});
