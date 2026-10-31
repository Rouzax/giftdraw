import { makeCycle } from '../draw/cycle.js';
import { signupDeadlineError } from '../limits.js';
import { finishSignup, sendSignup } from '../people.js';
import { answerSeen, joins, signupActive, signupState } from '../signup.js';
import { todayIn } from '../time.js';
import { signupFinishView, tooLateForSignup } from '../views/admin.js';
import { adminLang } from './admin-auth.js';
import { field } from './admin-shared.js';

const MIN_GROUP = 3;
// The done notice each deadline post leads to, by the state it started in.
const DEADLINE_DONE = { off: 'signup-on', setup: 'signup-moved', open: 'signup-moved', closed: 'signup-reopened' };
const ANSWERS = new Set(['yes', 'no']);

// The event-wide sign-up step: one deadline, one send, one close for all
// groups of the event.
export function adminSignupRoutes(app, ctx, {
  render, sendError, eventPage, personPage, loadEvent, loadParticipant, resubmitted, redirectDone,
}) {
  const { repo, config } = ctx;

  const stateOf = (event) => signupState(event, ctx.now(), config.tz);
  const eventUrl = (event, done) => `/admin/events/${event.id}${done ? `?done=${done}` : ''}`;

  function refuse(request, reply, event, reason, status, signupValue = '') {
    request.log.info({ event_id: event.id, reason }, 'signup_refused');
    const view = eventPage(adminLang(request), event, { signupError: `admin.signup.error.${reason}`, signupValue });
    return render(request, reply, view, status);
  }

  // Turns sign-up on, moves its deadline, or reopens it, depending on where
  // it stands. Turning on clears every pairing: the pairs are made from the
  // yes answers once sign-up is done.
  app.post('/admin/events/:id/signup', loadEvent, async (request, reply) => {
    const event = request.record;
    const state = stateOf(event);
    const deadline = field(request.body, 'deadline', 10).trim();
    if (!Object.hasOwn(DEADLINE_DONE, state)) return refuse(request, reply, event, 'state', 409);
    const groups = repo.listGroups(event.id);
    if (state === 'off' && tooLateForSignup(groups.map((group) => ({ group, people: repo.listParticipants(group.id) })))) {
      return refuse(request, reply, event, 'invited', 400, deadline);
    }
    const code = signupDeadlineError(deadline, todayIn(ctx.now(), config.tz), groups);
    if (code) return refuse(request, reply, event, code, 400, deadline);
    const now = ctx.nowIso();
    repo.tx(() => {
      if (state === 'off') {
        repo.updateEvent(event.id, { signupDeadline: deadline, signupSentAt: null, signupClosedAt: null }, now);
        for (const group of groups) repo.setAssignment(group.id, null, now);
      } else {
        // A new deadline after closing opens the sign-up again.
        repo.updateEvent(event.id, { signupDeadline: deadline, signupClosedAt: null }, now);
      }
    });
    if (state === 'off') request.log.info({ event_id: event.id, groups: groups.length }, 'signup_enabled');
    else if (state === 'closed') request.log.info({ event_id: event.id }, 'signup_reopened');
    else request.log.info({ event_id: event.id }, 'signup_deadline_moved');
    return reply.redirect(eventUrl(event, DEADLINE_DONE[state]), 303);
  });

  // Only before sending: once people were asked, their answers count. The
  // groups are paired as they would be without sign-up.
  app.post('/admin/events/:id/signup/off', loadEvent, async (request, reply) => {
    const event = request.record;
    const state = stateOf(event);
    // A second press finds sign-up already off, which is the requested result.
    if (state === 'off') return reply.redirect(eventUrl(event), 303);
    if (state !== 'setup') return refuse(request, reply, event, 'state', 409);
    const now = ctx.nowIso();
    const groups = repo.listGroups(event.id);
    repo.tx(() => {
      repo.updateEvent(event.id, { signupDeadline: null }, now);
      for (const group of groups) {
        const ids = repo.listParticipants(group.id).map((p) => p.id);
        repo.setAssignment(group.id, ids.length >= MIN_GROUP ? makeCycle(ids) : null, now);
      }
    });
    request.log.info({ event_id: event.id, groups: groups.length }, 'signup_disabled');
    return reply.redirect(eventUrl(event, 'signup-off'), 303);
  });

  app.post('/admin/events/:id/signup/send', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const event = request.record;
    const result = sendSignup(ctx, event.id);
    if (result.refused === 'open' || result.refused === 'closed') {
      // A press from a page loaded before the sign-up went out: the
      // requested result is already there.
      return redirectDone(request, reply, eventUrl(event));
    }
    if (result.refused === 'passed') return refuse(request, reply, event, 'signup-passed', 409);
    if (result.refused) return refuse(request, reply, event, 'state', 409);
    request.log.info({ event_id: event.id, queued: result.queued, mail_enabled: ctx.mailer.enabled }, 'signup_sent');
    return redirectDone(request, reply, eventUrl(event, 'signup-sent'));
  });

  app.post('/admin/events/:id/signup/close', loadEvent, async (request, reply) => {
    const event = request.record;
    const state = stateOf(event);
    if (state === 'closed') return reply.redirect(eventUrl(event), 303);
    if (state !== 'open') return refuse(request, reply, event, 'state', 409);
    repo.updateEvent(event.id, { signupClosedAt: ctx.nowIso() }, ctx.nowIso());
    request.log.info({ event_id: event.id, by: 'organiser' }, 'signup_closed');
    return reply.redirect(eventUrl(event, 'signup-closed'), 303);
  });

  // The organiser records an answer given to her, from the sign-up lists or
  // the person page. back returns to one of those two pages only, so the
  // field cannot be used as an open redirect. seen is the answer the page
  // showed: a form from before the person or another page changed it would
  // silently overrule a newer answer, so it is refused, as is a form
  // without it. An answer already stored as posted is the requested result,
  // for instance after a double tap, so it leads back without a write.
  app.post('/admin/participants/:id/signup', loadParticipant, async (request, reply) => {
    const participant = request.record;
    const answer = request.body?.answer;
    if (!ANSWERS.has(answer)) return sendError(reply, 400, adminLang(request));
    const event = repo.getEvent(repo.getGroup(participant.groupId).eventId);
    const fromPerson = request.body?.back === 'person';
    const refuseHere = (reason, signupError) => {
      request.log.info({ event_id: event.id, participant_id: participant.id, reason }, 'signup_refused');
      const lang = adminLang(request);
      const view = fromPerson ? personPage(lang, participant, { signupError }) : eventPage(lang, event, { signupError });
      return render(request, reply, view, 409);
    };
    if (!signupActive(event, ctx.now(), config.tz)) return refuseHere('state', 'admin.signup.error.state');
    const back = fromPerson ? `/admin/participants/${participant.id}` : `${eventUrl(event)}#signup`;
    if (participant.signup === answer) return reply.redirect(back, 303);
    if (request.body?.seen !== answerSeen(participant)) {
      return refuseHere('changed', ['admin.signup.error.changed', { name: participant.name }]);
    }
    repo.updateParticipant(participant.id, { signup: answer, signupAt: ctx.nowIso() });
    request.log.info({ participant_id: participant.id, event_id: event.id }, 'signup_set');
    return reply.redirect(back, 303);
  });

  // status is 409 when a press was refused because a group is too small;
  // the page then says why and offers no confirmation.
  function finishPage(request, reply, event, status = 200) {
    const state = stateOf(event);
    if (state === 'done') return reply.redirect(eventUrl(event), 303);
    if (state !== 'closed') return refuse(request, reply, event, 'state', 409);
    const groups = repo.listGroups(event.id).map((group) => {
      const people = repo.listParticipants(group.id);
      return { group, joining: people.filter(joins), leaving: people.filter((p) => !joins(p)) };
    });
    const today = todayIn(ctx.now(), config.tz);
    const view = signupFinishView(adminLang(request), { event, groups, today, mailEnabled: ctx.mailer.enabled, tz: config.tz });
    return render(request, reply, view, status);
  }

  app.get('/admin/events/:id/signup/finish', loadEvent, async (request, reply) => finishPage(request, reply, request.record));

  // Removing people cannot be undone, so the post acts only with the ticked
  // confirmation; without it the confirmation page comes back.
  app.post('/admin/events/:id/signup/finish', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const event = request.record;
    if (request.body?.confirm !== '1') return finishPage(request, reply, event);
    const result = finishSignup(ctx, event.id);
    if (result.refused === 'done') return redirectDone(request, reply, eventUrl(event));
    if (result.refused === 'too-small') {
      request.log.info({ event_id: event.id, reason: 'too-small', groups: result.groupIds.length }, 'signup_refused');
      return finishPage(request, reply, event, 409);
    }
    if (result.refused) return refuse(request, reply, event, 'state', 409);
    request.log.info({
      event_id: event.id, joined: result.joined, removed: result.removed, groups_unpaired: result.unpairedGroupIds.length,
    }, 'signup_finished');
    return redirectDone(request, reply, eventUrl(event, 'signup-done'));
  });
}
