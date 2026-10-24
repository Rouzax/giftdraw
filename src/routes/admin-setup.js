import { insertIntoCycle } from '../draw/cycle.js';
import { isLang, t } from '../i18n/index.js';
import { kickDrain } from '../mail/outbox.js';
import {
  commitAddParticipants, parsePasteList, PASTE_ROWS_MAX, PASTE_TEXT_MAX, PLAN_JSON_MAX, planAddParticipants,
  resendGroupFailed, sendInvitations,
} from '../people.js';
import { groupDatesError, HEADING_MAX, NAME_MAX, OPTIONS_MAX, PLACE_MAX, THEME_MAX } from '../limits.js';
import { unixLines } from '../text.js';
import { todayIn } from '../time.js';
import {
  cleanHeading, formConfigValue, optionLines, optionsToStore, petOptions, readFormConfig, SECTION_IDS, wishOptions,
} from '../wishes.js';
import { adminLang } from './admin-auth.js';
import { field, parseJsonField } from './admin-shared.js';
import { EVENT_DONE, eventsView, eventView, GROUP_DONE, messageView, pasteConfirmView } from '../views/admin.js';


export function adminSetupRoutes(app, ctx, {
  render, sendError, groupPage, loadEvent, loadGroup, resubmitted, redirectDone, takeFlash,
}) {
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

  // Returns {values} or {error}.
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
    if (values.exchangePlace !== null && values.exchangePlace.length > PLACE_MAX) {
      return { values, error: 'admin.group.error.exchangePlace' };
    }
    const dates = groupDatesError(values, today(), current);
    return dates ? { values, error: `admin.group.error.${dates}` } : { values };
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
    return eventView(lang, {
      event,
      groups,
      newGroup,
      themeValue: event.themeText ?? t(event.language, 'theme.default'),
      optionsValue: optionLines(wishOptions(event), event.language),
      sections: readFormConfig(event.formConfig).sections,
      petsValue: optionLines(petOptions(event), event.language),
      tz: config.tz,
      mailEnabled: ctx.mailer.enabled,
      ...extra,
    });
  }

  // The section controls post a marker, because an unticked show box sends
  // nothing: without the marker the stored sections are kept as they are.
  // A heading equal to a built-in one stays empty, so it keeps following
  // each participant's language.
  function readFormSections(body, event) {
    const current = readFormConfig(event.formConfig);
    let sections = current.sections;
    if (body?.formSections === '1') {
      sections = {};
      for (const id of SECTION_IDS) {
        const heading = cleanHeading(field(body, `heading_${id}`, HEADING_MAX * 4));
        const builtIn = ['nl', 'en'].some((l) => t(l, `wish.${id}`) === heading);
        sections[id] = { show: body[`show_${id}`] === '1', heading: builtIn ? null : heading };
      }
    }
    let pets = current.petOptions;
    if (typeof body?.petOptions === 'string') {
      const value = optionsToStore(field(body, 'petOptions', OPTIONS_MAX), petOptions(event), event.language, 'pets');
      if (value !== undefined) pets = value;
    }
    return formConfigValue({ sections, petOptions: pets });
  }

  app.post('/admin/events', async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const name = field(request.body, 'name', NAME_MAX).trim();
    const language = isLang(request.body?.language) ? request.body.language : 'nl';
    const lang = adminLang(request);
    if (!name) {
      const view = eventsView(lang, repo.listEvents(), { error: 'admin.event.error.name', values: { name, language } });
      return render(request, reply, view, 400);
    }
    const id = repo.createEvent({ name, language }, ctx.nowIso());
    request.log.info({ event_id: id }, 'event_created');
    return redirectDone(request, reply, `/admin/events/${id}?done=event-created`);
  });

  app.get('/admin/events/:id', loadEvent, async (request, reply) => {
    const done = EVENT_DONE.has(request.query?.done) ? request.query.done : null;
    return render(request, reply, eventPage(adminLang(request), request.record, { done }));
  });

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
    let theme = field(body, 'themeText', THEME_MAX).trim();
    // A theme stored with CRLF line breaks comes back with LF: the same text,
    // kept as stored so printed cards do not count it as changed.
    if (event.themeText && unixLines(event.themeText) === theme) theme = event.themeText;
    const isDefault = ['nl', 'en'].some((l) => t(l, 'theme.default') === theme);
    repo.updateEvent(event.id, {
      name,
      language,
      cleanupWeeks: Number(weeks),
      themeText: theme && !isDefault ? theme : null,
      wishOptions: optionsToStore(field(body, 'wishOptions', OPTIONS_MAX), wishOptions(event), event.language, 'likes'),
      formConfig: readFormSections(body, event),
    }, ctx.nowIso());
    request.log.info({ event_id: event.id }, 'event_updated');
    return reply.redirect(`/admin/events/${event.id}?done=saved`, 303);
  });

  app.post('/admin/events/:id/delete', loadEvent, async (request, reply) => {
    if (request.body?.confirm !== '1') return sendError(reply, 400, adminLang(request));
    repo.deleteEvent(request.record.id);
    request.log.info({ event_id: request.record.id }, 'event_deleted');
    truncateLog(request);
    return reply.redirect('/admin', 303);
  });

  app.post('/admin/events/:id/groups', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const event = request.record;
    const { values, error } = readGroupForm(request.body);
    if (error) {
      const view = eventPage(adminLang(request), event, { groupError: error, newGroup: { ...values, autoOpenAt: values.autoOpenAt ?? '' } });
      return render(request, reply, view, 400);
    }
    const id = repo.createGroup(event.id, values, ctx.nowIso());
    request.log.info({ event_id: event.id, group_id: id }, 'group_created');
    return redirectDone(request, reply, `/admin/groups/${id}?done=group-created`);
  });

  app.get('/admin/groups/:id', loadGroup, async (request, reply) => {
    let done = GROUP_DONE.has(request.query?.done) ? request.query.done : null;
    const flash = takeFlash(request, reply);
    if (flash === 'tell' && (done === 'added' || done === 'removed')) done = `${done}-tell`;
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
    const again = resubmitted(request, reply);
    if (again) return again;
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
      return redirectDone(request, reply, `${dashboard}?done=added`, result.tellGivers ? 'tell' : null);
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
      return redirectDone(request, reply, `${dashboard}?done=added`, result.tellGivers ? 'tell' : null);
    }
    const changes = open ? previewChanges(plan, repo.listParticipants(group.id)) : null;
    const view = pasteConfirmView(lang, { group, plan, errors, changes, text: raw, mailEnabled: ctx.mailer.enabled });
    return render(request, reply, view);
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
