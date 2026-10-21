import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

// Static files are served as immutable for a year, so their URLs carry a
// hash of the files themselves: any changed, added or renamed file gives
// every page new URLs, without anyone having to remember a version bump.
// Each path and length is hashed ahead of its bytes, so moving content from
// one file to the next cannot give the same hash.
export function assetHash(dir) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => ({ path, name: relative(dir, path).split(sep).join('/') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash('sha256');
  for (const { path, name } of files) {
    const content = readFileSync(path);
    hash.update(`${name}\0${content.length}\0`).update(content);
  }
  return hash.digest('hex').slice(0, 10);
}
