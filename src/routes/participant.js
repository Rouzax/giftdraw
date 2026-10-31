import { hasWishes, typedLines } from '../answers.js';
import { isLang } from '../i18n/index.js';
import { createLimiter } from '../limiter.js';
import { drawFor, mailOn, saveWishes } from '../people.js';
import { wishForm } from '../questions.js';
import { signupActive, signupState } from '../signup.js';
import { participantScreen } from '../status.js';
import { participantPage } from '../views/layout.js';
import { aboutFormView, drawView, resultView, signupView, waitingView, welcomeView } from '../views/participant.js';

const MINUTE = 60_000;
const VIEWS = { welcome: welcomeView, waiting: waitingView, draw: drawView };
const ANSWERS = new Set(['yes', 'no']);

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
      return sendError(reply, 404, undefined, true);
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
      drawAction: `${base}/draw`,
      signupAction: `${base}/signup`,
      pageHref: base,
      langAction: `${base}/lang`,
      showLangSwitch: true,
      emailOn: mailOn(ctx),
    };
  }

  function render(reply, lang, { title, body, scripts }) {
    return sendPage(reply, participantPage({ lang, title, body, scripts, assetVersion: config.assetVersion }));
  }

  app.get('/p/:token', { onRequest: loadParticipant }, async (request, reply) => {
    let participant = request.participant;
    // HEAD runs this handler too; link scanners in mail clients send it.
    const counts = request.method !== 'HEAD';
    if (!participant.visitedAt && counts) {
      repo.updateParticipant(participant.id, { visitedAt: ctx.nowIso() });
      participant = repo.getParticipant(participant.id);
    }
    const data = screenData(participant);
    // A pair counts as seen once the reveal page loads, not when the button
    // is pressed, so the draw is recorded here.
    if (request.query.reveal === '1' && counts && data.group.openedAt && !participant.drawnAt) {
      const { receiver, firstTime } = drawFor(ctx, participant.id);
      if (firstTime) request.log.info({ participant_id: participant.id }, 'participant_drawn');
      return render(reply, data.lang, resultView({ ...data, receiver, reveal: true }));
    }
    const ask = ANSWERS.has(request.query.a) ? request.query.a : null;
    return render(reply, data.lang, currentScreen(data, { ask, change: request.query.change === '1' }));
  });

  // While the event is signing up, that step replaces every other screen.
  // signup holds what only the sign-up screen reads (ask, change, notSaved).
  function currentScreen(data, signup = {}) {
    const { participant, event } = data;
    if (signupActive(event, ctx.now(), config.tz)) {
      return signupView({ ...data, ...signup, state: signupState(event, ctx.now(), config.tz) });
    }
    const screen = participantScreen({
      hasWishes: hasWishes(participant.wishes, wishForm(event)),
      groupOpen: Boolean(data.group.openedAt),
      drawn: Boolean(participant.drawnAt),
    });
    const receiver = participant.receiverId ? repo.getParticipant(participant.receiverId) : null;
    if (screen === 'result' && receiver) return resultView({ ...data, receiver, reveal: false });
    const view = VIEWS[screen] ?? waitingView;
    return view(data);
  }

  // Answers only count while the sign-up is open; a page loaded before it
  // closed gets the page as it stands now, with nothing stored.
  app.post('/p/:token/signup', { onRequest: loadParticipant }, async (request, reply) => {
    const participant = request.participant;
    const answer = request.body?.answer;
    if (!ANSWERS.has(answer)) return sendError(reply, 400, participant.language);
    const data = screenData(participant);
    if (signupState(data.event, ctx.now(), config.tz) !== 'open') {
      return render(reply.code(409), data.lang, currentScreen(data, { notSaved: true }));
    }
    repo.updateParticipant(participant.id, { signup: answer, signupAt: ctx.nowIso() });
    request.log.info({ participant_id: participant.id }, 'signup_answer');
    return reply.redirect(`/p/${participant.token}`, 303);
  });

  app.get('/p/:token/about', { onRequest: loadParticipant }, async (request, reply) => {
    const data = screenData(request.participant);
    return render(reply, data.lang, aboutFormView({ ...data, wishes: request.participant.wishes }));
  });

  // A page loaded before an update can post fields this version cannot
  // read. Its form comes back with the stored answers, so the participant
  // sees nothing was saved instead of a redirect that looks like a save.
  function outdatedForm(request, reply, participant) {
    request.log.info({ group_id: participant.groupId }, 'wishes_form_outdated');
    const data = screenData(participant);
    return render(reply, data.lang, aboutFormView({ ...data, wishes: participant.wishes, outdated: true }));
  }

  // A page opened before a newer save or a question change: the form comes
  // back with what is saved now, and what the post held is listed above it.
  function staleForm(request, reply, participant) {
    request.log.info({ group_id: participant.groupId }, 'wishes_form_stale');
    const data = screenData(participant);
    const stale = typedLines(request.body, wishForm(data.event), participant.wishes, data.lang);
    return render(reply, data.lang, aboutFormView({ ...data, wishes: participant.wishes, stale }));
  }

  app.post('/p/:token/about', { onRequest: loadParticipant }, async (request, reply) => {
    const participant = request.participant;
    const result = saveWishes(ctx, participant.id, request.body);
    if (result === 'outdated') return outdatedForm(request, reply, participant);
    if (result === 'stale') return staleForm(request, reply, repo.getParticipant(participant.id));
    // No participant id: the wish-update lines that follow say something
    // about this person's giver, and together they would reveal the pair.
    request.log.info({ group_id: participant.groupId }, 'wishes_saved');
    return reply.redirect(`/p/${participant.token}`, 303);
  });

  app.post('/p/:token/draw', { onRequest: loadParticipant }, async (request, reply) => {
    const participant = request.participant;
    const base = `/p/${participant.token}`;
    const open = Boolean(repo.getGroup(participant.groupId).openedAt);
    return reply.redirect(open ? `${base}?reveal=1` : base, 303);
  });

  app.post('/p/:token/lang', { onRequest: loadParticipant }, async (request, reply) => {
    const participant = request.participant;
    const lang = request.body?.lang;
    if (!isLang(lang)) return sendError(reply, 400, participant.language);
    const fromAbout = request.body?.from === 'about';
    // The about form posted itself here: its answers are saved first. Only
    // that form sends the list of its questions; one rendered before
    // questions existed sends its sections instead, which cannot be read.
    const withWishes = fromAbout && typeof request.body?.questions === 'string';
    const outdated = fromAbout && !withWishes && typeof request.body?.sections === 'string';
    const stale = withWishes && saveWishes(ctx, participant.id, request.body) === 'stale';
    repo.updateParticipant(participant.id, { language: lang });
    // No participant id next to a wish save, as for wishes_saved: it would
    // tie this receiver to the giver the wish-update lines describe.
    if (withWishes && !stale) request.log.info({ group_id: participant.groupId, lang }, 'language_changed_wishes_saved');
    else request.log.info({ participant_id: participant.id, lang }, 'language_changed');
    if (outdated) return outdatedForm(request, reply, repo.getParticipant(participant.id));
    if (stale) return staleForm(request, reply, repo.getParticipant(participant.id));
    // Only known targets, so the form cannot be used as an open redirect.
    let back = '';
    if (fromAbout) back = '/about';
    else if (request.body?.change === '1') back = '?change=1';
    return reply.redirect(`/p/${participant.token}${back}`, 303);
  });
}
