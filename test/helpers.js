import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeContext } from '../src/context.js';
import { openDb } from '../src/db/open.js';
import { makeCycle } from '../src/draw/cycle.js';

export const TEST_ENV = {
  APP_URL: 'https://gifts.example.com',
  ADMIN_AUTH: 'password',
  ADMIN_PASSWORD: 'correct-horse-battery',
  SESSION_SECRET: 's'.repeat(32),
  LOG_LEVEL: 'info',
};

// Repeated keys (likes=tea&likes=wine) come from array values.
export function formBody(form) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(name, item);
  }
  return params.toString();
}

export async function makeTestApp({ configOverrides = {}, clock } = {}) {
  const config = { ...loadConfig(TEST_ENV), ...configOverrides };
  const mails = [];
  const mailer = {
    enabled: true,
    async send(message) {
      mails.push(message);
    },
  };
  const logs = [];
  const logStream = new Writable({
    write(chunk, encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const ctx = makeContext({ config, db: openDb(':memory:'), mailer, clock, logStream });
  const app = await buildApp(ctx);

  // A header set to undefined or null is left out, so a test can drop Origin.
  function post(url, form = {}, headers = {}) {
    const merged = { 'content-type': 'application/x-www-form-urlencoded', origin: config.appOrigin, ...headers };
    for (const [name, value] of Object.entries(merged)) {
      if (value === undefined || value === null) delete merged[name];
    }
    return app.inject({ method: 'POST', url, payload: formBody(form), headers: merged });
  }

  return { app, ctx, mails, logs, post };
}

export function seedGroup(ctx, { names, withEmail = true, invited = true, opened = false }) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  const eventId = repo.createEvent({ name: 'Gifts 2026', language: 'nl' }, now);
  const groupId = repo.createGroup(eventId, { name: 'Monday', exchangeDate: '2026-12-18' }, now);
  const rows = names.map((name) => ({
    name,
    email: withEmail ? `${name.toLowerCase()}@example.com` : null,
    language: 'nl',
  }));
  const added = repo.addParticipantsWithAssignment(
    groupId, rows, (ids) => (ids.length >= 3 ? makeCycle(ids) : null), now,
  );
  if (invited) {
    for (const p of added) repo.updateParticipant(p.id, { invitedAt: now });
  }
  if (opened) {
    repo.markInvitationsSent(groupId, now);
    repo.markGroupOpened(groupId, now);
  }
  return {
    event: repo.getEvent(eventId),
    group: repo.getGroup(groupId),
    people: added.map((p) => repo.getParticipant(p.id)),
  };
}
