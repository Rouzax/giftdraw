import { randomBytes } from 'node:crypto';

export function newToken() {
  return randomBytes(32).toString('base64url');
}
