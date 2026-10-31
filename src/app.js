import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { PUBLIC_DIR } from './assets.js';
import { normalisePath } from './context.js';
import { adminArrangeRoutes } from './routes/admin-arrange.js';
import { adminImportRoutes } from './routes/admin-import.js';
import { registerAdminAuth } from './routes/admin-auth.js';
import { adminPeopleRoutes } from './routes/admin-people.js';
import { adminQuestionRoutes } from './routes/admin-questions.js';
import { adminSetupRoutes } from './routes/admin-setup.js';
import { adminShared } from './routes/admin-shared.js';
import { adminSignupRoutes } from './routes/admin-signup.js';
import { participantRoutes } from './routes/participant.js';
import { errorPage } from './views/layout.js';

const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex',
  // same-origin, not no-referrer: with no-referrer browsers send Origin: null
  // on same-origin form posts, which the CSRF check has to reject.
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
};

const PRIVATE_PATH = /^\/(p|admin)(\/|$)/;
const PARTICIPANT_PATH = /^\/p(\/|$)/;
const ADMIN_PATH = /^\/admin(\/|$)/;

// Both the matched route and the normalised URL are checked, so no spelling
// of a path that reaches a handler escapes a rule meant for that handler.
const pathMatches = (request, pattern) =>
  pattern.test(request.routeOptions.url ?? '') || pattern.test(normalisePath(request.url));

// A POST must come from our own pages. Without Origin and Referer (some
// privacy settings strip both) only participant routes pass, where the token
// in the URL is the credential; admin routes rely on a cookie and must not.
function originAllowed(request, appOrigin) {
  const { origin, referer } = request.headers;
  if (origin !== undefined) return origin === appOrigin;
  if (referer !== undefined) {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }
  return Boolean(request.routeOptions.url?.startsWith('/p/'));
}

export async function buildApp(ctx) {
  const { config } = ctx;

  const sendPage = (reply, page) => reply.type('text/html; charset=utf-8').send(page);
  const sendError = (reply, status, lang, linkGone = false) =>
    sendPage(reply.code(status), errorPage({ status, lang, assetVersion: config.assetVersion, linkGone }));

  const app = Fastify({
    loggerInstance: ctx.log,
    trustProxy: config.trustedProxies.length > 0 ? config.trustedProxies : false,
    // Fastify answers a malformed URL with JSON that echoes the path. This
    // reply skips the onSend hooks, so the headers are set here as well.
    frameworkErrors(error, request, reply) {
      request.log.info({ error_code: error.code }, 'bad_request');
      return sendError(reply.headers(SECURITY_HEADERS), 400);
    },
  });

  app.decorateRequest('participant', null);

  await app.register(cookie);
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: '/static/',
    decorateReply: false,
    index: false,
    maxAge: '365d',
    immutable: true,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html') && pathMatches(request, PRIVATE_PATH)) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' || originAllowed(request, config.appOrigin)) return;
    request.log.warn({ method: request.method }, 'csrf_rejected');
    return sendError(reply, 403, request.participant?.language);
  });

  // Any /p/ address that leads nowhere gets the same page as an unknown token.
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method }, 'not_found');
    return sendError(reply, 404, undefined, pathMatches(request, PARTICIPANT_PATH));
  });

  // Only the class is logged: messages can carry SQL, paths or user input.
  app.setErrorHandler((error, request, reply) => {
    const code = error?.statusCode;
    const status = code >= 400 && code < 500 ? code : 500;
    const fields = { error_class: error?.name ?? typeof error, status };
    if (status >= 500) request.log.error(fields, 'request_error');
    else request.log.info(fields, 'request_error');
    return sendError(reply, status, request.participant?.language);
  });

  // Container probes call this every few seconds; warn keeps Fastify's
  // per-request info lines out of the log. A failing query throws into the
  // error handler, so the probe sees a 500.
  app.get('/health', { logLevel: 'warn' }, async () => ({ ok: ctx.repo.ping() }));

  // Browsers fetch /favicon.ico on their own, whatever the page links; the
  // SVG answers it so that request is no 404 in their consoles.
  const favicon = readFileSync(join(PUBLIC_DIR, 'favicon.svg'));
  app.get('/favicon.ico', { logLevel: 'warn' }, async (request, reply) =>
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400').send(favicon));

  const isParticipantPath = (request) => pathMatches(request, PARTICIPANT_PATH);
  participantRoutes(app, ctx, { sendPage, sendError, isParticipantPath });
  registerAdminAuth(app, ctx, { sendPage, isAdminPath: (request) => pathMatches(request, ADMIN_PATH) });
  const shared = adminShared(ctx, { sendPage, sendError });
  adminSetupRoutes(app, ctx, shared);
  adminSignupRoutes(app, ctx, shared);
  adminQuestionRoutes(app, ctx, shared);
  adminImportRoutes(app, ctx, shared);
  adminArrangeRoutes(app, ctx, shared);
  adminPeopleRoutes(app, ctx, shared);

  return app;
}
