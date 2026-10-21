import { isLang, t } from '../i18n/index.js';
import {
  commitRemoveParticipant, normaliseEmail, planRemoveParticipant, remindNow, resendFailed, resendInvite,
} from '../people.js';
import { reminderKind } from '../reminders.js';
import { newToken } from '../tokens.js';
import { messageView, PERSON_DONE, participantView, removeView } from '../views/admin.js';
import { adminLang } from './admin-auth.js';
import { field, ID, parseJsonField } from './admin-shared.js';

const NAME_MAX = 100;
const EMAIL_INPUT_MAX = 1000;
// A [giver, receiver] pair of 15-digit ids is at most 35 characters of JSON,
// so this holds the plan of a group far larger than any real one.
const REMOVE_PLAN_MAX = 200_000;
const REMOVE_STATUS = { stale: 409, 'too-small': 409, invalid: 400 };
const REMOVE_MESSAGE = { stale: 'admin.remove.stale', 'too-small': 'admin.remove.tooSmall', invalid: 'admin.remove.invalid' };

export function adminPeopleRoutes(app, ctx, { render, sendError, loadParticipant }) {
  const { repo, config } = ctx;

  const personUrl = (id, done) => `/admin/participants/${id}${done ? `?done=${done}` : ''}`;

  function personPage(lang, participant, extra = {}) {
    const group = repo.getGroup(participant.groupId);
    return participantView(lang, {
      participant,
      group,
      receiver: participant.receiverId ? repo.getParticipant(participant.receiverId) : null,
      mail: repo.mailStatus(participant.id),
      link: `${config.appUrl}/p/${participant.token}`,
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
      if (request.body?.back === 'group') return reply.redirect(`/admin/groups/${participant.groupId}`, 303);
      return reply.redirect(personUrl(participant.id, outcome), 303);
    });
  }
  mailAction('resend-invite', resendInvite, 'invite_resent');
  mailAction('remind', remindNow, 'reminder_sent_manually');
  mailAction('resend-failed', resendFailed, 'failed_mail_requeued');

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
