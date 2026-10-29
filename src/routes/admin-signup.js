import { makeCycle } from '../draw/cycle.js';
import { signupDeadlineError } from '../limits.js';
import { sendSignup } from '../people.js';
import { signupState } from '../signup.js';
import { todayIn } from '../time.js';
import { adminLang } from './admin-auth.js';
import { field } from './admin-shared.js';

const MIN_GROUP = 3;
// The done notice each deadline post leads to, by the state it started in.
const DEADLINE_DONE = { off: 'signup-on', setup: 'signup-moved', open: 'signup-moved', closed: 'signup-reopened' };

// The event-wide sign-up step: one deadline, one send, one close for all
// groups of the event.
export function adminSignupRoutes(app, ctx, { render, eventPage, loadEvent, resubmitted, redirectDone }) {
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
    // Invitations lead straight to the draw, so after them it is too late
    // to ask who takes part.
    if (state === 'off' && groups.some((g) => g.invitationsSentAt || g.openedAt)) {
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
    // A second press finds sign-up already off: what she asked for.
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
      // A press from a page loaded before the sign-up went out: what she
      // asked for has happened.
      return redirectDone(request, reply, eventUrl(event));
    }
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
}
