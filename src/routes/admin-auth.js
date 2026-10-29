import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { isLang } from '../i18n/index.js';
import { createLimiter } from '../limiter.js';
import { renderAdminPage } from '../views/layout.js';
import { eventsView, loginView, noAccessView } from '../views/admin.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SESSION_MAX_AGE_MS = 30 * DAY;
const SESSION_COOKIE = 'giftdraw_admin';
const LANG_COOKIE = 'giftdraw_lang';
const ADMIN_PATH = /^\/admin(\/|$)/;
// Reachable without a session in password mode. Matched on the route
// pattern, so only these handlers are exempt, never another spelling.
const OPEN_ROUTES = new Set(['/admin/login', '/admin/lang']);
const SESSION_VALUE = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/;
// Admin paths a GET shows as a page. A page that answers a POST (a refusal,
// a confirmation step) carries the POST's path, which may be no page at all.
const ADMIN_PAGES = [
  /^\/admin$/,
  /^\/admin\/login$/,
  /^\/admin\/events\/\d+$/,
  /^\/admin\/events\/\d+\/questions\/(?!new$)[^/]+$/,
  /^\/admin\/groups\/\d+(\/arrange)?$/,
  /^\/admin\/participants\/\d+(\/about|\/remove)?$/,
];
const SWAP_PATH = /^(\/admin\/groups\/\d+)\/swap$/;

const sha256 = (value) => createHash('sha256').update(value).digest();

// Node reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d.
function unmapIpv4(address) {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address ?? '');
  return match ? match[1] : address;
}

function familyOf(address) {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

function proxyMatcher(entries) {
  const list = new BlockList();
  for (const entry of entries) {
    const [rawAddress, prefix] = entry.split('/');
    const address = unmapIpv4(rawAddress);
    if (prefix === undefined) list.addAddress(address, familyOf(address));
    else list.addSubnet(address, Number(prefix), familyOf(address));
  }
  return (remoteAddress) => {
    const address = unmapIpv4(remoteAddress);
    return isIP(address) !== 0 && list.check(address, familyOf(address));
  };
}

// The key depends on the password, so changing ADMIN_PASSWORD ends every
// existing session without any stored session state.
function sessionSigner(config) {
  const key = createHmac('sha256', config.sessionSecret).update(sha256(config.adminPassword)).digest();
  const sign = (issuedAt) => createHmac('sha256', key).update(issuedAt).digest('base64url');
  return {
    issue: (now) => `${now}.${sign(String(now))}`,
    valid(value, now) {
      const match = SESSION_VALUE.exec(value ?? '');
      if (!match) return false;
      // The digits as sent, not re-serialised, so 0123 and 123 sign differently.
      const expected = Buffer.from(sign(match[1]));
      if (!timingSafeEqual(Buffer.from(match[2]), expected)) return false;
      const age = now - Number(match[1]);
      return age >= 0 && age <= SESSION_MAX_AGE_MS;
    },
  };
}

export function adminLang(request) {
  const lang = request.cookies?.[LANG_COOKIE];
  return isLang(lang) ? lang : 'nl';
}

// The nearest page at or above the path; a refused swap belongs to the
// arrange page rather than the dashboard.
function pageFor(pathname) {
  if (SWAP_PATH.test(pathname)) return pathname.replace(SWAP_PATH, '$1/arrange');
  for (let path = pathname; ADMIN_PATH.test(path); path = path.slice(0, path.lastIndexOf('/'))) {
    if (ADMIN_PAGES.some((page) => page.test(path))) return path;
  }
  return '/admin';
}

// Same-origin admin pages only, so the switch cannot redirect elsewhere.
function returnPath(referer, appOrigin) {
  try {
    const url = new URL(referer);
    if (url.origin === appOrigin && ADMIN_PATH.test(url.pathname)) return pageFor(url.pathname);
  } catch {
    // Missing or malformed Referer: fall through to the dashboard.
  }
  return '/admin';
}

export function registerAdminAuth(app, ctx, { sendPage, isAdminPath }) {
  const { config, repo } = ctx;
  const passwordMode = config.adminAuth === 'password';
  const cookieOptions = {
    path: '/admin',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https:'),
  };

  function render(request, reply, { title, body }, status = 200, { showLangSwitch = true } = {}) {
    const lang = adminLang(request);
    const page = renderAdminPage(lang, {
      title,
      body,
      assetVersion: config.assetVersion,
      showLangSwitch,
      showLogout: request.adminSession === true,
    });
    return sendPage(reply.code(status), page);
  }

  app.decorateRequest('adminSession', false);

  if (passwordMode) {
    registerPasswordMode();
  } else {
    registerProxyMode();
  }

  app.post('/admin/lang', async (request, reply) => {
    const lang = request.body?.lang;
    if (isLang(lang)) reply.setCookie(LANG_COOKIE, lang, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 });
    return reply.redirect(returnPath(request.headers.referer, config.appOrigin), 303);
  });

  app.get('/admin', async (request, reply) => render(request, reply, eventsView(adminLang(request), repo.listEvents())));

  function registerProxyMode() {
    const trusted = proxyMatcher(config.trustedProxies);

    // The socket address, never request.ip: X-Forwarded-For is client input
    // until the connection itself is known to come from the proxy.
    app.addHook('onRequest', async (request, reply) => {
      if (!isAdminPath(request)) return;
      let reason = null;
      if (!trusted(request.socket.remoteAddress)) reason = 'untrusted_source';
      else if (!String(request.headers[config.adminUserHeader] ?? '').trim()) reason = 'missing_user';
      if (reason === null) return;
      // Anyone can reach the port and be refused, which needs no action; a
      // trusted proxy without the user header is a misconfiguration.
      if (reason === 'untrusted_source') request.log.info({ reason }, 'admin_proxy_rejected');
      else request.log.warn({ reason }, 'admin_proxy_rejected');
      // The switch posts to /admin/lang, which this same check would refuse.
      return render(request, reply, noAccessView(adminLang(request)), 403, { showLangSwitch: false });
    });
  }

  function registerPasswordMode() {
    const signer = sessionSigner(config);
    const passwordDigest = sha256(config.adminPassword);
    const perIp = createLimiter({ limit: 10, windowMs: 15 * MINUTE });
    const overall = createLimiter({ limit: 50, windowMs: 60 * MINUTE });

    app.addHook('onRequest', async (request, reply) => {
      if (!isAdminPath(request)) return;
      if (signer.valid(request.cookies[SESSION_COOKIE], ctx.now().getTime())) {
        request.adminSession = true;
        return;
      }
      if (OPEN_ROUTES.has(request.routeOptions.url)) return;
      if (request.method === 'GET' || request.method === 'HEAD') return reply.redirect('/admin/login', 303);
      request.log.info({ method: request.method }, 'admin_session_missing');
      // Mostly a session that ran out while a form was open: say so and
      // offer the login rather than a dead end.
      return render(request, reply, loginView(adminLang(request), { error: 'admin.login.expired' }), 403);
    });

    app.get('/admin/login', async (request, reply) => render(request, reply, loginView(adminLang(request))));

    app.post('/admin/login', async (request, reply) => {
      const now = ctx.now().getTime();
      const lang = adminLang(request);
      if (perIp.blocked(request.ip, now) || overall.blocked('all', now)) {
        request.log.warn('admin_login_blocked');
        return render(request, reply, loginView(lang, { error: 'admin.login.tooMany' }), 429);
      }
      const given = typeof request.body?.password === 'string' ? request.body.password : '';
      // Digests have a fixed length, so the comparison leaks nothing about it.
      if (!timingSafeEqual(sha256(given), passwordDigest)) {
        perIp.hit(request.ip, now);
        overall.hit('all', now);
        request.log.warn('admin_login_failed');
        return render(request, reply, loginView(lang, { error: 'admin.login.wrong' }), 401);
      }
      request.log.info('admin_login');
      reply.setCookie(SESSION_COOKIE, signer.issue(now), { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS / 1000 });
      return reply.redirect('/admin', 303);
    });

    app.post('/admin/logout', async (request, reply) => {
      request.log.info('admin_logout');
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return reply.redirect('/admin/login', 303);
    });
  }
}
