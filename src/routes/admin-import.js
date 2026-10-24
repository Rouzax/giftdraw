import { createHash } from 'node:crypto';
import { createEventFromPlan, eventFile, eventFileName, IMPORT_TEXT_MAX, readEventFile } from '../event-file.js';
import { unixLines } from '../text.js';
import { todayIn } from '../time.js';
import { importCheckView, importView } from '../views/import.js';
import { adminLang } from './admin-auth.js';

// Percent-encoded an accented letter takes six bytes, so a text at
// IMPORT_TEXT_MAX comes close to the default 1 MiB limit.
const BODY_LIMIT = 2 * 1024 * 1024;
const IMPORTED_TTL_MS = 24 * 60 * 60_000;
const IMPORTED_MAX = 200;

export function adminImportRoutes(app, ctx, { render, loadEvent, resubmitted, redirectDone }) {
  const { repo, config } = ctx;

  // Files imported lately, by a digest of their text. Back to the check page
  // after an import gives its confirm button a fresh form token, so the
  // double-submit guard alone would let the same file make a second event.
  // In memory, like the guard: it only has to cover the same sitting.
  const imported = new Map();
  const digest = (text) => createHash('sha256').update(text).digest('base64url');

  function remember(key, eventId) {
    const at = ctx.now().getTime();
    imported.delete(key);
    imported.set(key, { eventId, at });
    for (const [k, entry] of imported) {
      if (imported.size <= IMPORTED_MAX && at - entry.at <= IMPORTED_TTL_MS) break;
      imported.delete(k);
    }
  }

  function earlierImport(key) {
    const entry = imported.get(key);
    if (!entry || ctx.now().getTime() - entry.at > IMPORTED_TTL_MS) return null;
    return repo.getEvent(entry.eventId) ? entry.eventId : null;
  }

  function check(text) {
    const existingNames = new Set(repo.listEvents().map((e) => e.name.toLowerCase()));
    return readEventFile(text, { today: todayIn(ctx.now(), config.tz), existingNames });
  }

  app.get('/admin/events/import', async (request, reply) => render(request, reply, importView(adminLang(request))));

  app.post('/admin/events/import', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const lang = adminLang(request);
    // Browsers send line breaks as CRLF but count each as one character
    // against the field's maxlength, so the text is measured as LF.
    const raw = typeof request.body?.text === 'string' ? unixLines(request.body.text) : '';
    // The text is never cut short: a cut file would read as broken JSON.
    // An overlong one is refused by the check and not shown again.
    const text = raw.length > IMPORT_TEXT_MAX ? '' : raw;
    const result = check(raw);
    const page = importCheckView(lang, { text, result, tz: config.tz });
    if (request.body?.confirm !== '1') {
      request.log.info({ errors: result.errors.length, warnings: result.warnings.length }, 'event_import_checked');
      return render(request, reply, page, result.errors.length ? 400 : 200);
    }
    // Checked again on confirm: a date can have passed since the check.
    if (result.errors.length) {
      request.log.info({ errors: result.errors.length }, 'event_import_refused');
      return render(request, reply, page, 400);
    }
    const key = digest(raw);
    const earlier = earlierImport(key);
    if (earlier !== null) {
      request.log.info({ event_id: earlier }, 'event_import_repeated');
      return redirectDone(request, reply, `/admin/events/${earlier}?done=already-imported`);
    }
    const created = createEventFromPlan(ctx, result.plan);
    remember(key, created.eventId);
    request.log.info({ event_id: created.eventId, groups: created.groups, participants: created.participants }, 'event_imported');
    return redirectDone(request, reply, `/admin/events/${created.eventId}?done=imported`);
  });

  app.get('/admin/events/:id/export', loadEvent, async (request, reply) => {
    const event = request.record;
    const file = eventFile(event, repo.listGroups(event.id));
    request.log.info({ event_id: event.id }, 'event_exported');
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${eventFileName(event)}"`)
      .header('Cache-Control', 'no-store')
      .send(`${JSON.stringify(file, null, 2)}\n`);
  });
}
