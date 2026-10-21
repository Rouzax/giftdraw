import { cardOutOfDate, groupWarnings } from '../status.js';
import { hasWishes } from '../wishes.js';
import { adminLang } from './admin-auth.js';
import { behalfPage, printPage, renderAdminPage } from '../views/layout.js';
import { groupView } from '../views/admin.js';

export const ID = /^\d{1,15}$/;

export function field(body, name, max = 1000) {
  const value = body?.[name];
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Malformed or oversized JSON becomes null, which the commit functions refuse
// as invalid; it is never cut short.
export function parseJsonField(value, max) {
  if (typeof value !== 'string' || value.length > max) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// The page shell, the id checks and the group dashboard, shared by every
// admin route module.
export function adminShared(ctx, { sendPage, sendError }) {
  const { repo, config } = ctx;

  function render(request, reply, view, status = 200) {
    const page = renderAdminPage(adminLang(request), {
      ...view,
      assetVersion: config.assetVersion,
      showLogout: request.adminSession === true,
    });
    return sendPage(reply.code(status), page);
  }

  // view comes in the participant's language; note and back link are the
  // organiser's.
  function renderBehalf(request, reply, participant, view, { note, back }, status = 200) {
    const page = behalfPage({
      ...view, lang: participant.language, adminLang: adminLang(request), assetVersion: config.assetVersion, note, back,
    });
    return sendPage(reply.code(status), page);
  }

  function renderPrint(reply, participant, view) {
    return sendPage(reply, printPage({ ...view, lang: participant.language, assetVersion: config.assetVersion }));
  }

  function load(getter) {
    return async (request, reply) => {
      const record = ID.test(request.params.id) ? getter(Number(request.params.id)) : null;
      if (!record) return sendError(reply, 404, adminLang(request));
      request.record = record;
    };
  }

  function groupPage(lang, group, extra = {}) {
    const event = repo.getEvent(group.eventId);
    const people = repo.listParticipants(group.id);
    const byId = new Map(people.map((p) => [p.id, p]));
    const rows = people.map((participant) => {
      const receiver = participant.receiverId ? byId.get(participant.receiverId) ?? null : null;
      return {
        participant,
        receiver,
        hasWishes: hasWishes(participant.wishes),
        mail: repo.mailStatus(participant.id),
        cardOutOfDate: cardOutOfDate(participant, receiver),
      };
    });
    return groupView(lang, {
      event,
      group,
      rows,
      warnings: groupWarnings(group, people.length),
      mailEnabled: ctx.mailer.enabled,
      tz: config.tz,
      ...extra,
    });
  }

  return {
    sendError,
    render,
    renderBehalf,
    renderPrint,
    groupPage,
    loadEvent: { preHandler: load(repo.getEvent) },
    loadGroup: { preHandler: load(repo.getGroup) },
    loadParticipant: { preHandler: load(repo.getParticipant) },
  };
}
