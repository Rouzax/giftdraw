import { isLang } from '../i18n/index.js';
import { createLimiter } from '../limiter.js';
import { saveWishes } from '../people.js';
import { hasWishes } from '../wishes.js';
import { participantScreen } from '../status.js';
import { participantPage } from '../views/layout.js';
import { aboutFormView, waitingView, welcomeView } from '../views/participant.js';

const MINUTE = 60_000;
const VIEWS = { welcome: welcomeView, waiting: waitingView };

// Registered on the root instance so the block check also covers /p/ URLs
// that match no route.
export function participantRoutes(app, ctx, { sendPage, sendError, isParticipantPath }) {
  const { repo, config } = ctx;
  // Failed lookups are the guessing signal; once an IP reaches the limit,
  // even its valid links are refused so a guesser learns nothing from hits.
  const failures = createLimiter({ limit: 20, windowMs: MINUTE });
  // Generous enough for a whole class sharing one community-centre IP.
  const traffic = createLimiter({ limit: 600, windowMs: MINUTE });

  app.addHook('onRequest', async (request, reply) => {
    if (isParticipantPath(request) && failures.blocked(request.ip, ctx.now().getTime())) {
      request.log.warn({ method: request.method }, 'participant_ip_blocked');
      return sendError(reply, 429);
    }
  });

  async function loadParticipant(request, reply) {
    const now = ctx.now().getTime();
    const participant = repo.getParticipantByToken(request.params.token);
    if (!participant) {
      failures.hit(request.ip, now);
      request.log.info({ method: request.method }, 'token_unknown');
      return sendError(reply, 404);
    }
    if (!traffic.hit(request.ip, now)) {
      request.log.warn({ participant_id: participant.id }, 'participant_rate_limited');
      return sendError(reply, 429, participant.language);
    }
    request.participant = participant;
  }

  function screenData(participant) {
    const group = repo.getGroup(participant.groupId);
    const event = repo.getEvent(group.eventId);
    const base = `/p/${participant.token}`;
    return {
      participant,
      group,
      event,
      lang: participant.language,
      tz: config.tz,
      editHref: `${base}/about`,
      formAction: `${base}/about`,
      langAction: `${base}/lang`,
      showLangSwitch: true,
    };
  }

  function render(reply, lang, { title, body }) {
    return sendPage(reply, participantPage({ lang, title, body, assetVersion: config.assetVersion }));
  }

  app.get('/p/:token', { onRequest: loadParticipant }, async (request, reply) => {
    let participant = request.participant;
    // HEAD runs this handler too; link scanners in mail clients send it.
    if (!participant.visitedAt && request.method !== 'HEAD') {
      repo.updateParticipant(participant.id, { visitedAt: ctx.nowIso() });
      participant = repo.getParticipant(participant.id);
    }
    const data = screenData(participant);
    const wished = hasWishes(participant.wishes);
    const screen = participantScreen({
      hasWishes: wished,
      groupOpen: Boolean(data.group.openedAt),
      drawn: Boolean(participant.drawnAt),
    });
    // Without a draw screen, an open group still shows the pre-draw screen.
    const view = VIEWS[screen] ?? (wished ? waitingView : welcomeView);
    return render(reply, data.lang, view(data));
  });

  app.get('/p/:token/about', { onRequest: loadParticipant }, async (request, reply) => {
    const data = screenData(request.participant);
    return render(reply, data.lang, aboutFormView({ ...data, wishes: request.participant.wishes }));
  });

  app.post('/p/:token/about', { onRequest: loadParticipant }, async (request, reply) => {
    saveWishes(ctx, request.participant.id, request.body);
    request.log.info({ participant_id: request.participant.id }, 'wishes_saved');
    return reply.redirect(`/p/${request.participant.token}`, 303);
  });

  app.post('/p/:token/lang', { onRequest: loadParticipant }, async (request, reply) => {
    const participant = request.participant;
    const lang = request.body?.lang;
    if (!isLang(lang)) return sendError(reply, 400, participant.language);
    repo.updateParticipant(participant.id, { language: lang });
    request.log.info({ participant_id: participant.id, lang }, 'language_changed');
    // Only known targets, so the form cannot be used as an open redirect.
    const back = request.body?.from === 'about' ? '/about' : '';
    return reply.redirect(`/p/${participant.token}${back}`, 303);
  });
}
