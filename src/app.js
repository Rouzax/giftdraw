import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { normalisePath } from './context.js';
import { registerAdminAuth } from './routes/admin-auth.js';
import { participantRoutes } from './routes/participant.js';
import { errorPage } from './views/layout.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

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
  const sendError = (reply, status, lang) =>
    sendPage(reply.code(status), errorPage({ status, lang, assetVersion: config.assetVersion }));

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

  app.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method }, 'not_found');
    return sendError(reply, 404);
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

  const isParticipantPath = (request) => pathMatches(request, PARTICIPANT_PATH);
  participantRoutes(app, ctx, { sendPage, sendError, isParticipantPath });
  registerAdminAuth(app, ctx, { sendPage, isAdminPath: (request) => pathMatches(request, ADMIN_PATH) });

  return app;
}
