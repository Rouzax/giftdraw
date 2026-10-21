import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetHash } from '../src/assets.js';

function tempPublic() {
  const dir = mkdtempSync(join(tmpdir(), 'giftdraw-assets-'));
  mkdirSync(join(dir, 'css'));
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'css', 'base.css'), 'body { color: black; }\n');
  writeFileSync(join(dir, 'js', 'reveal.js'), "'use strict';\n");
  return dir;
}

test('the asset hash is ten hex characters and stable for the same files', (t) => {
  const dir = tempPublic();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = assetHash(dir);
  assert.match(first, /^[0-9a-f]{10}$/);
  assert.equal(assetHash(dir), first);
});

test('the asset hash changes when a file changes, is added or is renamed', (t) => {
  const dir = tempPublic();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seen = new Set([assetHash(dir)]);
  const step = (change) => {
    change();
    const next = assetHash(dir);
    assert.equal(seen.has(next), false);
    seen.add(next);
  };
  step(() => writeFileSync(join(dir, 'css', 'base.css'), 'body { color: navy; }\n'));
  step(() => writeFileSync(join(dir, 'css', 'print.css'), ''));
  step(() => renameSync(join(dir, 'js', 'reveal.js'), join(dir, 'js', 'print.js')));
});
