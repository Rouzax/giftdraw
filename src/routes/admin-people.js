import qrcode from 'qrcode-generator';
import { html } from '../html.js';
import { isLang, t } from '../i18n/index.js';
import {
  commitRemoveParticipant, drawFor, normaliseEmail, planRemoveParticipant, remindNow, resendFailed, resendInvite,
  saveWishes,
} from '../people.js';
import { reminderKind } from '../reminders.js';
import { cardOutOfDate } from '../status.js';
import { newToken } from '../tokens.js';
import { cardTools, messageView, PERSON_DONE, participantView, removeView } from '../views/admin.js';
import { aboutFormView, cardView, resultView } from '../views/participant.js';
import { adminLang } from './admin-auth.js';
import { field, ID, parseJsonField } from './admin-shared.js';

const NAME_MAX = 100;
const EMAIL_INPUT_MAX = 1000;
// A [giver, receiver] pair of 15-digit ids is at most 35 characters of JSON,
// so this holds the plan of a group far larger than any real one.
const REMOVE_PLAN_MAX = 200_000;
const REMOVE_STATUS = { stale: 409, 'too-small': 409, invalid: 400 };
const REMOVE_MESSAGE = { stale: 'admin.remove.stale', 'too-small': 'admin.remove.tooSmall', invalid: 'admin.remove.invalid' };
// Error correction M keeps a printed code readable with a smudge or a fold.
const QR_LEVEL = 'M';
const QR_CELL = 8;

export function adminPeopleRoutes(app, ctx, { render, renderBehalf, renderPrint, sendError, loadParticipant }) {
  const { repo, config } = ctx;

  const personUrl = (id, done) => `/admin/participants/${id}${done ? `?done=${done}` : ''}`;
  const personalLink = (participant) => `${config.appUrl}/p/${participant.token}`;
  const receiverOf = (participant) => (participant.receiverId ? repo.getParticipant(participant.receiverId) : null);

  function personPage(lang, participant, extra = {}) {
    const group = repo.getGroup(participant.groupId);
    const receiver = receiverOf(participant);
    return participantView(lang, {
      participant,
      group,
      receiver,
      cardOutOfDate: cardOutOfDate(participant, receiver, group, repo.getEvent(group.eventId)),
      mail: repo.mailStatus(participant.id),
      link: personalLink(participant),
      remindKind: reminderKind(participant, group),
      mailEnabled: ctx.mailer.enabled,
      tz: config.tz,
      ...extra,
    });
  }

  app.get('/admin/participants/:id', loadParticipant, async (request, reply) => {
    const done = PERSON_DONE.has(request.query?.done) ? request.query.done : null;
    return render(request, reply, personPage(adminLang(request), request.record, { done }));
  });

  // Changing the address of someone already invited sends nothing by itself;
  // the organiser resends the invitation when she wants to.
  app.post('/admin/participants/:id', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const body = request.body;
    const lang = adminLang(request);
    const values = {
      name: field(body, 'name', NAME_MAX).trim(),
      email: field(body, 'email', EMAIL_INPUT_MAX).trim(),
      language: body?.language,
    };
    const email = values.email ? normaliseEmail(values.email) : null;
    let error = null;
    if (!values.name) error = 'admin.person.error.name';
    else if (values.email && !email) error = 'admin.person.error.email';
    else if (!isLang(values.language)) error = 'admin.person.error.language';
    if (error) {
      const view = personPage(lang, participant, { error, values: { ...values, language: isLang(values.language) ? values.language : participant.language } });
      return render(request, reply, view, 400);
    }

    const changedEmail = email !== null && email !== participant.email?.toLowerCase();
    if (changedEmail && body?.confirmDuplicate !== '1') {
      const event = repo.getGroup(participant.groupId).eventId;
      const other = repo.findEmailInEvent(event, email, participant.id);
      if (other) {
        const duplicate = { email, groupName: repo.getGroup(other.groupId).name };
        return render(request, reply, personPage(lang, participant, { values: { ...values, email }, duplicate }));
      }
    }
    repo.updateParticipant(participant.id, { name: values.name, email, language: values.language });
    request.log.info({ participant_id: participant.id }, 'participant_updated');
    return reply.redirect(personUrl(participant.id, 'saved'), 303);
  });

  // Mails still queued render the link when they are sent, so they carry the
  // new one. Nothing is sent: the organiser decides how to pass it on.
  app.post('/admin/participants/:id/regenerate-link', loadParticipant, async (request, reply) => {
    if (request.body?.confirm !== '1') return sendError(reply, 400, adminLang(request));
    repo.updateParticipant(request.record.id, { token: newToken() });
    request.log.info({ participant_id: request.record.id }, 'participant_link_regenerated');
    return reply.redirect(personUrl(request.record.id, 'link-regenerated'), 303);
  });

  function mailAction(path, action, event) {
    app.post(`/admin/participants/:id/${path}`, loadParticipant, async (request, reply) => {
      const participant = request.record;
      const outcome = action(ctx, participant.id);
      request.log.info({ participant_id: participant.id, outcome }, event);
      if (request.body?.back === 'group') return reply.redirect(`/admin/groups/${participant.groupId}?done=${outcome}`, 303);
      return reply.redirect(personUrl(participant.id, outcome), 303);
    });
  }
  mailAction('resend-invite', resendInvite, 'invite_resent');
  mailAction('remind', remindNow, 'reminder_sent_manually');
  mailAction('resend-failed', resendFailed, 'failed_mail_requeued');

  // The SVG holds the link, which is a credential: it is never cached or logged.
  app.get('/admin/participants/:id/qr', loadParticipant, async (request, reply) => {
    const code = qrcode(0, QR_LEVEL);
    code.addData(personalLink(request.record), 'Byte');
    code.make();
    const svg = code.createSvgTag({ cellSize: QR_CELL, margin: QR_CELL * 4, scalable: true });
    return reply.type('image/svg+xml; charset=utf-8').header('Cache-Control', 'no-store').send(svg);
  });

  // The on-behalf screens are the participant's own, so they appear in the
  // participant's language; links on them lead back into the admin pages
  // rather than to the personal link.
  function screenData(participant) {
    const group = repo.getGroup(participant.groupId);
    const base = `/admin/participants/${participant.id}`;
    return {
      participant,
      group,
      event: repo.getEvent(group.eventId),
      lang: participant.language,
      tz: config.tz,
      editHref: `${base}/about`,
      formAction: `${base}/about`,
      langAction: null,
      showLangSwitch: false,
    };
  }

  function behalfFrame(request, participant) {
    const lang = adminLang(request);
    return {
      note: t(lang, 'admin.behalf.bar', { name: participant.name }),
      back: { href: `/admin/participants/${participant.id}`, label: t(lang, 'admin.behalf.back', { name: participant.name }) },
    };
  }

  function refuse(request, reply, participant, titleKey, messageKey) {
    const lang = adminLang(request);
    const view = messageView(lang, {
      titleKey, messageKey, href: `/admin/participants/${participant.id}`, linkText: participant.name,
    });
    return render(request, reply, view, 409);
  }

  app.get('/admin/participants/:id/about', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const view = aboutFormView({ ...screenData(participant), wishes: participant.wishes });
    return renderBehalf(request, reply, participant, view, behalfFrame(request, participant));
  });

  app.post('/admin/participants/:id/about', loadParticipant, async (request, reply) => {
    saveWishes(ctx, request.record.id, request.body);
    request.log.info({ participant_id: request.record.id }, 'wishes_saved_on_behalf');
    return reply.redirect(personUrl(request.record.id, 'wishes-saved'), 303);
  });

  // Rendered straight from the POST, because the organiser draws with the
  // participant beside her; drawFor is idempotent, so a reload only shows the
  // result again without the reveal.
  app.post('/admin/participants/:id/draw', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const data = screenData(participant);
    if (!data.group.openedAt || !participant.receiverId) {
      return refuse(request, reply, participant, 'admin.behalf.notOpenTitle', 'admin.behalf.notOpen');
    }
    const { receiver, firstTime } = drawFor(ctx, participant.id);
    if (firstTime) request.log.info({ participant_id: participant.id }, 'participant_drawn_on_behalf');
    const editText = t(adminLang(request), 'admin.behalf.editWishes', { name: participant.name });
    const view = resultView({ ...data, receiver, reveal: firstTime, editText });
    return renderBehalf(request, reply, participant, view, behalfFrame(request, participant));
  });

  function cardReceiver(participant) {
    return participant.drawnAt ? receiverOf(participant) : null;
  }

  app.get('/admin/participants/:id/card', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const receiver = cardReceiver(participant);
    if (!receiver) return refuse(request, reply, participant, 'admin.card.notDrawnTitle', 'admin.card.notDrawn');
    const data = screenData(participant);
    const card = cardView({ ...data, receiver });
    const tools = cardTools(adminLang(request), {
      participant, cardOutOfDate: cardOutOfDate(participant, receiver, data.group, data.event),
    });
    return renderPrint(reply, participant, { title: card.title, body: html`${tools}${card.body}` });
  });

  // Marked before the print dialog opens: a cancelled print still counts,
  // which only means the organiser may print once more than needed.
  app.post('/admin/participants/:id/card/printed', loadParticipant, async (request, reply) => {
    const participant = request.record;
    if (!cardReceiver(participant)) return refuse(request, reply, participant, 'admin.card.notDrawnTitle', 'admin.card.notDrawn');
    repo.updateParticipant(participant.id, { printedAt: ctx.nowIso() });
    request.log.info({ participant_id: participant.id }, 'card_printed');
    return reply.redirect(`/admin/participants/${participant.id}/card?print=1`, 303);
  });

  app.get('/admin/participants/:id/remove', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const group = repo.getGroup(participant.groupId);
    const plan = planRemoveParticipant(ctx, participant.id);
    const open = Boolean(group.openedAt) && Boolean(plan.map);
    let changes = [];
    if (open) {
      const byId = new Map(repo.listParticipants(group.id).map((p) => [p.id, p]));
      changes = plan.changedGivers.map((id) => ({
        giverName: byId.get(id).name,
        newReceiverName: byId.get(plan.map.get(id)).name,
        drawn: Boolean(byId.get(id).drawnAt),
        hasEmail: Boolean(byId.get(id).email),
      }));
    }
    const view = removeView(adminLang(request), {
      participant,
      group,
      plan: { ...plan, map: plan.map ? [...plan.map] : null },
      open,
      changes,
    });
    return render(request, reply, view);
  });

  // No loader here: a repeated confirm finds the participant already gone
  // and is answered like any other outdated confirmation.
  app.post('/admin/participants/:id/remove', async (request, reply) => {
    const lang = adminLang(request);
    if (!ID.test(request.params.id)) return sendError(reply, 404, lang);
    const id = Number(request.params.id);
    const before = repo.getParticipant(id);
    const result = commitRemoveParticipant(ctx, id, parseJsonField(request.body?.plan, REMOVE_PLAN_MAX));
    if (result.error) {
      request.log.info({ participant_id: id, reason: result.error }, 'participant_remove_refused');
      const groupId = before?.groupId ?? (ID.test(field(request.body, 'group', 15)) ? Number(request.body.group) : null);
      const group = groupId === null ? null : repo.getGroup(groupId);
      const link = before
        ? { href: `/admin/participants/${id}/remove`, linkText: t(lang, 'admin.remove.checkAgain') }
        : group ? { href: `/admin/groups/${group.id}`, linkText: group.name } : { href: '/admin', linkText: t(lang, 'admin.events.back') };
      const view = messageView(lang, { titleKey: 'admin.remove.refusedTitle', messageKey: REMOVE_MESSAGE[result.error], ...link });
      return render(request, reply, view, REMOVE_STATUS[result.error]);
    }
    request.log.info(
      { participant_id: id, group_id: result.removed.groupId, changed: result.changed.length, queued: result.queued },
      'participant_removed',
    );
    return reply.redirect(`/admin/groups/${result.removed.groupId}`, 303);
  });
}
