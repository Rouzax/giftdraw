import { insertIntoCycle } from '../draw/cycle.js';
import { isLang, t } from '../i18n/index.js';
import { kickDrain } from '../mail/outbox.js';
import {
  commitAddParticipants, parsePasteList, PASTE_ROWS_MAX, PASTE_TEXT_MAX, PLAN_JSON_MAX, planAddParticipants,
  resendGroupFailed, sendInvitations,
} from '../people.js';
import { todayIn } from '../time.js';
import { mergeOptionLabels, wishOptions } from '../wishes.js';
import { adminLang } from './admin-auth.js';
import { field, parseJsonField } from './admin-shared.js';
import { eventsView, eventView, GROUP_DONE, messageView, pasteConfirmView } from '../views/admin.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NAME_MAX = 100;
const PLACE_MAX = 200;
const THEME_MAX = 2000;
const OPTIONS_MAX = 4000;

function isDate(value) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function adminSetupRoutes(app, ctx, { render, sendError, groupPage, loadEvent, loadGroup }) {
  const { repo, config } = ctx;

  const today = () => todayIn(ctx.now(), config.tz);

  // Truncating the WAL keeps deleted participant data out of the log file.
  // The delete has already happened, so a busy database only costs that.
  function truncateLog(request) {
    try {
      repo.checkpoint();
    } catch (err) {
      request.log.warn({ error_class: err?.name ?? typeof err }, 'checkpoint_failed');
    }
  }

  // Returns {values} or {error}. Dates already stored may stay as they are,
  // so renaming a group whose dates have passed still works.
  function readGroupForm(body, current = null) {
    const values = {
      name: field(body, 'name', NAME_MAX).trim(),
      exchangeDate: field(body, 'exchangeDate', 10).trim(),
      exchangeTime: field(body, 'exchangeTime', 10).trim() || null,
      // The place is shown inside one sentence, so line breaks become spaces.
      // Read past the limit so an overlong place is refused, not cut short.
      exchangePlace: field(body, 'exchangePlace', PLACE_MAX * 2).replace(/\s+/g, ' ').trim() || null,
      autoOpenAt: field(body, 'autoOpenAt', 10).trim() || null,
    };
    if (!values.name) return { values, error: 'admin.group.error.name' };
    if (values.exchangeTime !== null && !TIME.test(values.exchangeTime)) return { values, error: 'admin.group.error.exchangeTime' };
    if (values.exchangePlace !== null && values.exchangePlace.length > PLACE_MAX) {
      return { values, error: 'admin.group.error.exchangePlace' };
    }
    if (!isDate(values.exchangeDate)) return { values, error: 'admin.group.error.exchangeDate' };
    const sameExchange = current && current.exchangeDate === values.exchangeDate;
    if (!sameExchange && values.exchangeDate < today()) return { values, error: 'admin.group.error.exchangePast' };
    if (values.autoOpenAt !== null) {
      if (!isDate(values.autoOpenAt)) return { values, error: 'admin.group.error.autoOpenAt' };
      const unchanged = current && current.autoOpenAt === values.autoOpenAt;
      if (!unchanged && values.autoOpenAt < today()) return { values, error: 'admin.group.error.autoOpenPast' };
      if (values.autoOpenAt > values.exchangeDate) return { values, error: 'admin.group.error.autoOpenAfter' };
    }
    return { values };
  }

  function eventPage(lang, event, extra = {}) {
    const groups = repo.listGroups(event.id).map((group) => ({ group, size: repo.listParticipants(group.id).length }));
    const latest = repo.latestGroup(event.id);
    const newGroup = {
      name: '',
      exchangeDate: latest?.exchangeDate ?? '',
      exchangeTime: latest?.exchangeTime ?? '',
      exchangePlace: latest?.exchangePlace ?? '',
      autoOpenAt: latest?.autoOpenAt && latest.autoOpenAt >= today() ? latest.autoOpenAt : '',
    };
    const options = wishOptions(event).map((o) => `${o.label(event.language)}${o.detail ? '?' : ''}`).join('\n');
    return eventView(lang, {
      event,
      groups,
      newGroup,
      themeValue: event.themeText ?? t(event.language, 'theme.default'),
      optionsValue: options,
      tz: config.tz,
      ...extra,
    });
  }

  app.post('/admin/events', async (request, reply) => {
    const name = field(request.body, 'name', NAME_MAX).trim();
    const language = isLang(request.body?.language) ? request.body.language : 'nl';
    const lang = adminLang(request);
    if (!name) {
      const view = eventsView(lang, repo.listEvents(), { error: 'admin.event.error.name', values: { name, language } });
      return render(request, reply, view, 400);
    }
    const id = repo.createEvent({ name, language }, ctx.nowIso());
    request.log.info({ event_id: id }, 'event_created');
    return reply.redirect(`/admin/events/${id}`, 303);
  });

  app.get('/admin/events/:id', loadEvent, async (request, reply) =>
    render(request, reply, eventPage(adminLang(request), request.record)));

  app.post('/admin/events/:id', loadEvent, async (request, reply) => {
    const event = request.record;
    const body = request.body;
    const name = field(body, 'name', NAME_MAX).trim();
    const language = isLang(body?.language) ? body.language : null;
    const weeks = field(body, 'cleanupWeeks', 3).trim();
    let error = null;
    if (!name) error = 'admin.event.error.name';
    else if (!language) error = 'admin.event.error.language';
    else if (!/^\d+$/.test(weeks) || Number(weeks) < 1 || Number(weeks) > 52) error = 'admin.event.error.cleanupWeeks';
    if (error) return render(request, reply, eventPage(adminLang(request), event, { error }), 400);

    // Saving the shown default unchanged keeps it a default, so it follows
    // the participant's language instead of freezing one translation.
    const theme = field(body, 'themeText', THEME_MAX).trim();
    const isDefault = ['nl', 'en'].some((l) => t(l, 'theme.default') === theme);
    const optionsText = field(body, 'wishOptions', OPTIONS_MAX);
    const options = optionsText.trim() ? mergeOptionLabels(optionsText, wishOptions(event), event.language) : [];
    repo.updateEvent(event.id, {
      name,
      language,
      cleanupWeeks: Number(weeks),
      themeText: theme && !isDefault ? theme : null,
      wishOptions: options.length ? options : null,
    }, ctx.nowIso());
    request.log.info({ event_id: event.id }, 'event_updated');
    return reply.redirect(`/admin/events/${event.id}`, 303);
  });

  app.post('/admin/events/:id/delete', loadEvent, async (request, reply) => {
    if (request.body?.confirm !== '1') return sendError(reply, 400, adminLang(request));
    repo.deleteEvent(request.record.id);
    request.log.info({ event_id: request.record.id }, 'event_deleted');
    truncateLog(request);
    return reply.redirect('/admin', 303);
  });

  app.post('/admin/events/:id/groups', loadEvent, async (request, reply) => {
    const event = request.record;
    const { values, error } = readGroupForm(request.body);
    if (error) {
      const view = eventPage(adminLang(request), event, { groupError: error, newGroup: { ...values, autoOpenAt: values.autoOpenAt ?? '' } });
      return render(request, reply, view, 400);
    }
    const id = repo.createGroup(event.id, values, ctx.nowIso());
    request.log.info({ event_id: event.id, group_id: id }, 'group_created');
    return reply.redirect(`/admin/groups/${id}`, 303);
  });

  app.get('/admin/groups/:id', loadGroup, async (request, reply) => {
    const done = GROUP_DONE.has(request.query?.done) ? request.query.done : null;
    return render(request, reply, groupPage(adminLang(request), request.record, { done }));
  });

  app.post('/admin/groups/:id', loadGroup, async (request, reply) => {
    const group = request.record;
    const { values, error } = readGroupForm(request.body, group);
    if (error) return render(request, reply, groupPage(adminLang(request), group, { error, values }), 400);
    repo.updateGroup(group.id, values, ctx.nowIso());
    request.log.info({ group_id: group.id }, 'group_updated');
    return reply.redirect(`/admin/groups/${group.id}`, 303);
  });

  app.post('/admin/groups/:id/delete', loadGroup, async (request, reply) => {
    if (request.body?.confirm !== '1') return sendError(reply, 400, adminLang(request));
    repo.deleteGroup(request.record.id);
    request.log.info({ group_id: request.record.id }, 'group_deleted');
    truncateLog(request);
    return reply.redirect(`/admin/events/${request.record.eventId}`, 303);
  });

  app.post('/admin/groups/:id/participants', loadGroup, async (request, reply) => {
    const group = request.record;
    const lang = adminLang(request);
    const dashboard = `/admin/groups/${group.id}`;
    if (request.body?.confirm === '1') {
      const result = commitAddParticipants(ctx, group.id, parseJsonField(request.body?.plan, PLAN_JSON_MAX));
      if (result.error) {
        request.log.info({ group_id: group.id, reason: result.error }, 'participants_add_refused');
        const stale = result.error === 'stale';
        const view = messageView(lang, {
          titleKey: 'admin.paste.refusedTitle',
          messageKey: stale ? 'admin.paste.stale' : 'admin.paste.invalid',
          href: dashboard,
          linkText: group.name,
        });
        return render(request, reply, view, stale ? 409 : 400);
      }
      request.log.info({ group_id: group.id, added: result.added.length }, 'participants_added');
      return reply.redirect(dashboard, 303);
    }

    const raw = typeof request.body?.text === 'string' ? request.body.text : '';
    const refuse = (message, pasteText) =>
      render(request, reply, groupPage(lang, group, { pasteError: message, pasteText }), 400);
    if (raw.length > PASTE_TEXT_MAX) return refuse(t(lang, 'admin.paste.tooLong', { max: PASTE_ROWS_MAX }), '');
    const { rows, errors } = parsePasteList(raw);
    if (rows.length > PASTE_ROWS_MAX) return refuse(t(lang, 'admin.paste.tooMany', { max: PASTE_ROWS_MAX }), raw);
    if (rows.length === 0 && errors.length === 0) return reply.redirect(dashboard, 303);
    const plan = planAddParticipants(ctx, group.id, rows);
    const open = plan.changedGivers.length > 0;
    if (errors.length === 0 && plan.duplicates.length === 0 && !open) {
      const result = commitAddParticipants(ctx, group.id, plan);
      if (result.error) throw new Error(`fresh plan refused: ${result.error}`);
      request.log.info({ group_id: group.id, added: result.added.length }, 'participants_added');
      return reply.redirect(dashboard, 303);
    }
    const changes = open ? previewChanges(plan, repo.listParticipants(group.id)) : null;
    return render(request, reply, pasteConfirmView(lang, { group, plan, errors, changes, text: raw }));
  });

  app.post('/admin/groups/:id/invite', loadGroup, async (request, reply) => {
    const group = request.record;
    const { queued } = sendInvitations(ctx, group.id);
    request.log.info({ group_id: group.id, queued, mail_enabled: ctx.mailer.enabled }, 'invitations_sent');
    if (queued > 0) kickDrain(ctx);
    return reply.redirect(`/admin/groups/${group.id}`, 303);
  });

  app.post('/admin/groups/:id/resend-failed', loadGroup, async (request, reply) => {
    const group = request.record;
    const outcome = resendGroupFailed(ctx, group.id);
    request.log.info({ group_id: group.id, outcome }, 'group_failed_mail_requeued');
    return reply.redirect(`/admin/groups/${group.id}?done=${outcome}`, 303);
  });

  // Placeholder ids stand in for newcomers who do not exist yet, so the page
  // shows each changed giver's final receiver even when two newcomers land
  // next to each other.
  function previewChanges(plan, people) {
    const byId = new Map(people.map((p) => [p.id, p]));
    let map = new Map(people.filter((p) => p.receiverId).map((p) => [p.id, p.receiverId]));
    plan.rows.forEach((row, i) => {
      map = insertIntoCycle(map, -(i + 1), row.insertGiverId).map;
    });
    return plan.changedGivers.map((id) => {
      const giver = byId.get(id);
      const receiver = map.get(id);
      return {
        giverName: giver.name,
        newReceiverName: receiver < 0 ? plan.rows[-receiver - 1].name : byId.get(receiver).name,
        drawn: Boolean(giver.drawnAt),
        hasEmail: Boolean(giver.email),
      };
    });
  }
}
