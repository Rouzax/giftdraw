import { cardOutOfDate, groupWarnings } from '../status.js';
import { createSubmitLog, formFingerprint } from '../submit-log.js';
import { clipText, unixLines } from '../text.js';
import { hasWishes, wishForm } from '../wishes.js';
import { adminLang } from './admin-auth.js';
import { behalfPage, printPage, renderAdminPage } from '../views/layout.js';
import { groupView } from '../views/admin.js';

export const ID = /^\d{1,15}$/;
const FLASH_COOKIE = 'giftdraw_flash';

export function field(body, name, max = 1000) {
  const value = body?.[name];
  return typeof value === 'string' ? clipText(unixLines(value), max) : '';
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
  const submitLog = createSubmitLog({ now: () => ctx.now().getTime() });

  const flashCookie = {
    path: '/admin', httpOnly: true, sameSite: 'lax', secure: config.appUrl.startsWith('https:'), maxAge: 300,
  };

  function redirectWith(reply, { location, flash }) {
    if (flash) reply.setCookie(FLASH_COOKIE, flash, flashCookie);
    return reply.redirect(location, 303);
  }

  // Answers a repeat of an earlier post the way the first one was answered
  // and returns the reply, or returns null for a post to act on. A route
  // calls this before doing anything and redirectDone after, with no await
  // between.
  function resubmitted(request, reply) {
    const result = submitLog.replay(request.body?.formToken, formFingerprint(request.body));
    if (!result) return null;
    request.log.info('form_resubmitted');
    return redirectWith(reply, result);
  }

  // flash is a note for the next page that must stay out of the URL, which
  // the reverse proxy logs: "tell" says a giver who had drawn got no mail,
  // a hint about the pairing.
  function redirectDone(request, reply, location, flash = null) {
    const result = { location, flash };
    submitLog.record(request.body?.formToken, formFingerprint(request.body), result);
    return redirectWith(reply, result);
  }

  // Read once: the cookie is cleared by the page that shows it.
  function takeFlash(request, reply) {
    const value = request.cookies?.[FLASH_COOKIE];
    if (value === undefined) return null;
    reply.clearCookie(FLASH_COOKIE, { path: flashCookie.path });
    return value;
  }

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
  function renderBehalf(request, reply, participant, view, { note, back }) {
    const page = behalfPage({
      ...view, lang: participant.language, adminLang: adminLang(request), assetVersion: config.assetVersion, note, back,
    });
    return sendPage(reply, page);
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
    const form = wishForm(event);
    const rows = people.map((participant) => {
      const receiver = participant.receiverId ? byId.get(participant.receiverId) ?? null : null;
      return {
        participant,
        receiver,
        hasWishes: hasWishes(participant.wishes, form),
        mail: repo.mailStatus(participant.id),
        cardOutOfDate: cardOutOfDate(participant, receiver, group, event),
      };
    });
    return groupView(lang, {
      event,
      group,
      rows,
      warnings: groupWarnings(group, people.length),
      mailEnabled: ctx.mailer.enabled,
      givenUpCount: repo.countGivenUp(group.id),
      tz: config.tz,
      ...extra,
    });
  }

  return {
    sendError,
    render,
    resubmitted,
    redirectDone,
    takeFlash,
    renderBehalf,
    renderPrint,
    groupPage,
    loadEvent: { preHandler: load(repo.getEvent) },
    loadGroup: { preHandler: load(repo.getGroup) },
    loadParticipant: { preHandler: load(repo.getParticipant) },
  };
}
