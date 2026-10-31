import { domainToASCII } from 'node:url';
import { parseWishesForm, readAnswers, staleWishesPost } from './answers.js';
import { chooseInsertGiver, insertIntoCycle, makeCycle, planRemoval, validateAssignment } from './draw/cycle.js';
import { NAME_MAX } from './limits.js';
import { errorCode, kickDrain } from './mail/outbox.js';
import { wishForm } from './questions.js';
import { reminderKind } from './reminders.js';
import { closesAt, joins, signupActive, signupState } from './signup.js';
import { assignmentVersion } from './status.js';
import { clipText, unixLines } from './text.js';

const MIN_GROUP = 3;
const EMAIL_MAX = 254;
const WISH_UPDATE_DELAY_MS = 15 * 60_000;
export const PASTE_ROWS_MAX = 500;
// Longest text a full paste can need: every row at the name and email caps.
export const PASTE_TEXT_MAX = PASTE_ROWS_MAX * (NAME_MAX + EMAIL_MAX + 4);
// Longest plan JSON a full paste can produce. JSON.stringify writes at most
// six characters per UTF-16 unit (\uXXXX), a name is at most NAME_MAX units,
// and each row adds fixed keys and a giver id.
export const PLAN_JSON_MAX = 64 + PASTE_ROWS_MAX * ((NAME_MAX + EMAIL_MAX) * 6 + 96);
// The address an email input accepts (the HTML standard's rule, after the
// domain is turned into punycode), with a dot in the domain. Anything wider
// could be pasted but never saved again from the participant's edit form,
// whose email field the browser checks.
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SEPARATOR = /[\t;,]/;

// Ticked choices are sets, so their order does not make a change, and
// texts stored with CRLF line breaks read the same as with LF.
function canonical(value) {
  if (typeof value === 'string') return unixLines(value);
  if (Array.isArray(value)) return value.map(canonical).sort();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// The answers as the form can show them. A stored row may still hold an
// answer to a removed question, a tick of a removed choice or a follow-up
// the organiser switched off; nobody sees those, so they do not count.
function onForm(wishes, form) {
  const answers = readAnswers(wishes);
  const out = {};
  for (const question of form.questions) {
    const answer = answers[question.id];
    if (answer === undefined) continue;
    if (question.type === 'text') {
      if (typeof answer === 'string') out[question.id] = answer;
      continue;
    }
    if (typeof answer === 'string') continue;
    const choices = new Set(question.choices.map((c) => c.id));
    const asks = new Set(question.choices.filter((c) => c.detail).map((c) => c.id));
    const ticked = answer.ticked.filter((id) => choices.has(id));
    const details = Object.fromEntries(Object.entries(answer.details).filter(([id]) => asks.has(id)));
    if (ticked.length || Object.keys(details).length) out[question.id] = { ticked, details };
  }
  return out;
}

// Answers are compared as read, not as stored, so a row in an older shape
// saved again with the same answers is no change.
function sameWishes(a, b, form) {
  return JSON.stringify(canonical(onForm(a, form))) === JSON.stringify(canonical(onForm(b, form)));
}

// Stores nothing for a post from a page whose fields cannot be read
// ('outdated', see parseWishesForm) or from a page rendered from other
// answers or another form ('stale', see wishesVersion). The version is
// checked inside the transaction, so of two pages rendered alike only the
// first save is stored.
export function saveWishes(ctx, participantId, body) {
  const { repo } = ctx;
  return repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    const event = repo.getEvent(repo.getGroup(participant.groupId).eventId);
    const form = wishForm(event);
    const wishes = parseWishesForm(body, form, participant.wishes);
    if (!wishes) return 'outdated';
    const stale = staleWishesPost(body, participant.wishes, form);
    // After a form change the post may hold input the current form cannot
    // read (a removed or hidden question, a removed choice), so it is
    // refused even when it changes nothing stored.
    if (stale === 'form') return 'stale';
    // A save without a change must not mark a printed card out of date or
    // mail the giver about nothing. From a page older than the stored
    // answers it loses nothing either, so a double tap on Save passes.
    if (sameWishes(participant.wishes, wishes, form)) return 'unchanged';
    if (stale === 'answers') return 'stale';
    const fields = { wishes, wishesUpdatedAt: ctx.nowIso() };
    // Saves within the window share one mail to the giver: the flag is set by
    // the first save and the scheduler sends once it is due.
    if (!participant.notifyGiverDueAt && repo.giverOf(participantId)?.drawnAt) {
      fields.notifyGiverDueAt = new Date(ctx.now().getTime() + WISH_UPDATE_DELAY_MS).toISOString();
    }
    repo.updateParticipant(participantId, fields);
    return 'saved';
  });
}

// The assignment is fixed beforehand, so drawing only reveals it. drawnAt is
// set once, by the first reveal, and later calls just look the receiver up.
export function drawFor(ctx, participantId) {
  const { repo } = ctx;
  return repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    if (!repo.getGroup(participant.groupId).openedAt) throw new Error('drawFor: group is not open');
    const receiver = participant.receiverId ? repo.getParticipant(participant.receiverId) : null;
    if (!receiver) throw new Error('drawFor: participant has no receiver');
    const firstTime = !participant.drawnAt;
    if (firstTime) repo.updateParticipant(participantId, { drawnAt: ctx.nowIso() });
    return { receiver, firstTime };
  });
}

// Every outgoing mail goes through here: with mail off nothing is queued,
// and callers skip any invitedAt they would set alongside.
export function mailOn(ctx) {
  return ctx.mailer.enabled === true;
}

export function enqueueMail(ctx, participantId, kind, now, options) {
  if (!mailOn(ctx)) return false;
  ctx.repo.enqueue(participantId, kind, now, options);
  return true;
}

// An accented domain is stored as punycode (cafe with an accent becomes
// xn--caf-dma), as the browser's email field sends it, so a pasted address
// and one typed on the person's page agree. The part before the @ must be
// ASCII either way.
export function normaliseEmail(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  const domain = at === -1 ? '' : domainToASCII(raw.slice(at + 1));
  if (!domain) return null;
  const email = `${raw.slice(0, at)}@${domain}`;
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

export function parsePasteList(text) {
  const rows = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((original, index) => {
    const line = original.trim();
    if (!line) return;
    const at = line.search(SEPARATOR);
    // In UTF-16 units, as the name fields' maxlength counts, so a pasted name
    // always fits the form that edits it.
    const name = clipText((at === -1 ? line : line.slice(0, at)).trim(), NAME_MAX).trim();
    const rawEmail = at === -1 ? '' : line.slice(at + 1).trim();
    const error = (reason) => errors.push({ line: index + 1, text: line, reason });
    // A bare address is a name missing, not a person called "a@b.c".
    if (!name || (at === -1 && name.includes('@'))) return error('no-name');
    if (!rawEmail) return rows.push({ name, email: null });
    const email = normaliseEmail(rawEmail);
    if (!email) return error('invalid-email');
    rows.push({ name, email });
  });
  return { rows, errors };
}

// Every member is in the version, unassigned ones too, so adding people to a
// group still too small for an assignment also makes an older plan stale.
function groupVersion(people) {
  const pairs = new Map(people.map((p) => [p.id, p.receiverId ?? null]));
  return assignmentVersion(pairs, people.filter((p) => p.drawnAt).map((p) => p.id));
}

function groupState(repo, groupId) {
  const group = repo.getGroup(groupId);
  const people = repo.listParticipants(groupId);
  const map = repo.getAssignment(groupId);
  // An open group always has a full assignment; without one, newcomers are
  // placed as in a closed group.
  const open = Boolean(group.openedAt) && map.size > 0;
  return { group, people, map, open, version: groupVersion(people) };
}

export function planAddParticipants(ctx, groupId, rows) {
  const { repo } = ctx;
  const { group, people, map, open, version } = groupState(repo, groupId);
  const notDrawn = new Set(people.filter((p) => !p.drawnAt).map((p) => p.id));
  const known = new Map();
  for (const other of repo.listGroups(group.eventId)) {
    for (const p of repo.listParticipants(other.id)) {
      if (p.email && !known.has(p.email.toLowerCase())) known.set(p.email.toLowerCase(), other.name);
    }
  }
  // otherGroupName null means the address came earlier in the same list.
  const duplicates = [];
  const inList = new Set();
  const planned = rows.map((row, index) => {
    const email = row.email?.toLowerCase();
    if (email && known.has(email)) duplicates.push({ row: index, otherGroupName: known.get(email) });
    else if (email && inList.has(email)) duplicates.push({ row: index, otherGroupName: null });
    if (email) inList.add(email);
    return { name: row.name, email: row.email ?? null, insertGiverId: open ? chooseInsertGiver(map, notDrawn) : null };
  });
  const changedGivers = [...new Set(planned.map((r) => r.insertGiverId).filter((id) => id !== null))];
  return { version, rows: planned, duplicates, changedGivers };
}

// The plan comes back from a hidden form field, so every row is checked
// again here rather than trusted.
function cleanPlanRows(plan) {
  if (!plan || typeof plan !== 'object' || typeof plan.version !== 'string') return null;
  if (!Array.isArray(plan.rows) || plan.rows.length === 0 || plan.rows.length > PASTE_ROWS_MAX) return null;
  const rows = [];
  for (const row of plan.rows) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string') return null;
    const name = row.name.trim();
    if (!name || name.length > NAME_MAX) return null;
    let email = null;
    if (row.email !== null && row.email !== undefined) {
      email = typeof row.email === 'string' ? normaliseEmail(row.email) : null;
      if (!email) return null;
    }
    const giver = row.insertGiverId ?? null;
    if (giver !== null && !Number.isSafeInteger(giver)) return null;
    rows.push({ name, email, insertGiverId: giver });
  }
  return rows;
}

function placeNewcomers(state, rows, ids) {
  const existing = new Set(state.people.map((p) => p.id));
  const newIds = ids.filter((id) => !existing.has(id));
  if (state.open) {
    let map = state.map;
    newIds.forEach((id, i) => {
      map = insertIntoCycle(map, id, rows[i].insertGiverId).map;
    });
    return map;
  }
  if (ids.length < MIN_GROUP) return null;
  if (state.map.size === 0 || !validateAssignment(state.map, [...existing])) return makeCycle(ids);
  let map = state.map;
  for (const id of newIds) map = insertIntoCycle(map, id, chooseInsertGiver(map, new Set())).map;
  return map;
}

export function commitAddParticipants(ctx, groupId, plan) {
  const { repo } = ctx;
  const rows = cleanPlanRows(plan);
  if (!rows) return { error: 'invalid' };
  const now = ctx.nowIso();
  const result = repo.tx(() => {
    const state = groupState(repo, groupId);
    if (state.version !== plan.version) return { error: 'stale' };
    for (const { insertGiverId: giver } of rows) {
      // A plan made before the group opened has no givers: the group moved on.
      if (state.open && giver === null) return { error: 'stale' };
      if (state.open ? !state.map.has(giver) : giver !== null) return { error: 'invalid' };
    }
    const event = repo.getEvent(state.group.eventId);
    const at = ctx.now();
    const signup = signupState(event, at, ctx.config.tz);
    // While sign-up is active nobody is paired: the pairs are made from the
    // yes answers once it is done.
    const active = signupActive(event, at, ctx.config.tz);
    const withLanguage = rows.map(({ name, email }) => ({ name, email, language: event.language }));
    const added = repo.addParticipantsWithAssignment(
      groupId, withLanguage, (ids) => (active ? null : placeNewcomers(state, rows, ids)), now,
    );
    const after = repo.getAssignment(groupId);
    const everyone = [...state.people.map((p) => p.id), ...added.map((p) => p.id)];
    if (after.size > 0 && !validateAssignment(after, everyone)) {
      throw new Error('commitAddParticipants: assignment is not a single valid pairing');
    }
    // Once a group's invitations are out, a newcomer is invited straight
    // away. In an open group that one invitation also says they can draw,
    // so no draw-open mail follows it.
    const invite = !active && (state.open || Boolean(state.group.invitationsSentAt));
    let queued = 0;
    // Someone added while sign-up is open is asked at once, like everyone
    // else was; someone added after it closed was added to take part.
    if (signup === 'open') queued += askToSignUp(ctx, added, now);
    if (signup === 'closed') {
      for (const p of added) repo.updateParticipant(p.id, { signup: 'yes', signupAt: now });
    }
    if (invite && mailOn(ctx)) {
      for (const p of added) {
        if (!p.email) continue;
        repo.updateParticipant(p.id, { invitedAt: now });
        enqueueMail(ctx, p.id, 'invite', now);
        queued += 1;
      }
    }
    let tellGivers = false;
    if (state.open) {
      for (const giver of state.people) {
        if (!giver.drawnAt || state.map.get(giver.id) === after.get(giver.id)) continue;
        if (giver.email && enqueueMail(ctx, giver.id, 'reassigned', now)) queued += 1;
        else tellGivers = true;
      }
    }
    return { added, queued, tellGivers };
  });
  if (result.queued) kickDrain(ctx);
  return result;
}

function pairingPaused(ctx, group) {
  return signupActive(ctx.repo.getEvent(group.eventId), ctx.now(), ctx.config.tz);
}

// In an open group the dropout's giver takes over the dropout's receiver;
// planRemoval re-inserts a giver left alone by a two-person loop, preferably
// in front of someone who has not drawn. A closed group too small to keep an
// assignment loses it until people are added.
export function planRemoveParticipant(ctx, id) {
  const { repo } = ctx;
  const participant = repo.getParticipant(id);
  const state = groupState(repo, participant.groupId);
  const remaining = state.people.filter((p) => p.id !== id).map((p) => p.id);
  const base = { version: state.version, map: null, changedGivers: [] };
  // While sign-up is active nobody is paired, whatever the group's size.
  if (pairingPaused(ctx, state.group)) return { ...base, signup: true };
  if (remaining.length < MIN_GROUP) return state.open ? { ...base, refused: 'too-small' } : base;
  let map;
  if (state.open || validateAssignment(state.map, state.people.map((p) => p.id))) {
    const notDrawn = new Set(state.people.filter((p) => !p.drawnAt).map((p) => p.id));
    map = planRemoval(state.map, id, state.open ? notDrawn : new Set()).map;
  } else {
    map = makeCycle(remaining);
  }
  const changedGivers = remaining.filter((giver) => state.map.get(giver) !== map.get(giver));
  return { ...base, map, changedGivers };
}

// The map comes back from a hidden form field. Where the group had a full
// assignment, the only freedom planRemoval has is where a lone giver is
// re-inserted, so recomputing with that choice must give the same map; any
// other map would move pairs the preview never showed.
function removalMapAllowed(state, id, map) {
  const everyone = state.people.map((p) => p.id);
  const remaining = everyone.filter((p) => p !== id);
  if (!validateAssignment(map, remaining)) return false;
  if (!validateAssignment(state.map, everyone)) return !state.open;
  const lone = [...state.map].find(([, r]) => r === id)[0];
  const insertAt = [...map].find(([, r]) => r === lone)?.[0];
  const expected = planRemoval(state.map, id, new Set([insertAt])).map;
  return expected.size === map.size && [...expected].every(([g, r]) => map.get(g) === r);
}

function cleanRemovalMap(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const map = new Map();
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger)) return undefined;
    if (map.has(pair[0])) return undefined;
    map.set(pair[0], pair[1]);
  }
  return map;
}

// plan: {version, map} with map as [giver, receiver] pairs or null. Returns
// {removed, changed, tellGivers} or {error: 'stale' | 'too-small' | 'invalid'}. A
// participant already gone counts as stale, so a repeated confirm reads as
// "something changed" rather than as a missing page.
export function commitRemoveParticipant(ctx, id, plan) {
  const { repo } = ctx;
  if (!plan || typeof plan !== 'object' || typeof plan.version !== 'string') return { error: 'invalid' };
  const map = cleanRemovalMap(plan.map);
  if (map === undefined) return { error: 'invalid' };
  const now = ctx.nowIso();
  const result = repo.tx(() => {
    const participant = repo.getParticipant(id);
    if (!participant) return { error: 'stale' };
    const state = groupState(repo, participant.groupId);
    if (state.version !== plan.version) return { error: 'stale' };
    const remaining = state.people.length - 1;
    if (state.open && remaining < MIN_GROUP) return { error: 'too-small' };
    // A group without pairs, too small or waiting for sign-up, must stay
    // without, so a map from the form cannot pair it.
    const unpaired = remaining < MIN_GROUP || pairingPaused(ctx, state.group);
    if (unpaired ? map !== null : map === null || !removalMapAllowed(state, id, map)) return { error: 'invalid' };
    repo.removeParticipantWithAssignment(id, map, now);
    const changed = state.people.filter((p) => p.id !== id && state.map.get(p.id) !== map?.get(p.id));
    let queued = 0;
    let tellGivers = false;
    for (const giver of changed.filter((p) => p.drawnAt)) {
      if (giver.email && enqueueMail(ctx, giver.id, 'reassigned', now)) queued += 1;
      else tellGivers = true;
    }
    return { removed: participant, changed: changed.map((p) => p.id), queued, tellGivers };
  });
  if (result.queued) kickDrain(ctx);
  return result;
}

// Runs in one transaction with the invitedAt check, so two overlapping
// presses queue each invitation once. With mail off nobody is marked as
// invited: the organiser shares the links herself.
export function sendInvitations(ctx, groupId) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  return repo.tx(() => {
    const event = repo.getEvent(repo.getGroup(groupId).eventId);
    // The invitation leads to the draw, which waits for the sign-up.
    if (signupActive(event, ctx.now(), ctx.config.tz)) return { refused: 'signup' };
    let queued = 0;
    if (mailOn(ctx)) {
      for (const p of repo.listParticipants(groupId)) {
        if (!p.email || p.invitedAt) continue;
        repo.updateParticipant(p.id, { invitedAt: now });
        enqueueMail(ctx, p.id, 'invite', now);
        queued += 1;
      }
    }
    repo.markInvitationsSent(groupId, now);
    return { queued };
  });
}

// Marks each person with an address as asked and queues the sign-up mail;
// with mail off nobody is marked, as with invitations. Someone whose answer
// the organiser already recorded is not asked, so no reminder or nudge
// follows either. Returns the count.
function askToSignUp(ctx, people, now) {
  if (!mailOn(ctx)) return 0;
  let queued = 0;
  for (const p of people) {
    if (!p.email || p.signupInvitedAt || p.signup) continue;
    ctx.repo.updateParticipant(p.id, { signupInvitedAt: now });
    enqueueMail(ctx, p.id, 'signup', now);
    queued += 1;
  }
  return queued;
}

// One press for the whole event. Runs in one transaction with the state
// check, so two overlapping presses send each mail once. Returns {queued} or
// {refused: state} when the sign-up is not waiting to be sent, and
// {refused: 'passed'} when its closing date is already over: sending then
// would open and close it at once.
export function sendSignup(ctx, eventId) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  const result = repo.tx(() => {
    const event = repo.getEvent(eventId);
    const state = signupState(event, ctx.now(), ctx.config.tz);
    if (state !== 'setup') return { refused: state };
    if (ctx.now() >= closesAt(event.signupDeadline, ctx.config.tz)) return { refused: 'passed' };
    repo.updateEvent(eventId, { signupSentAt: now }, now);
    return { queued: askToSignUp(ctx, repo.listEventParticipants(eventId), now) };
  });
  if (result.queued) kickDrain(ctx);
  return result;
}

// Starts the draw for the whole event: everyone who does not join is
// removed, each group is paired from who is left, and the sign-up is done.
// One transaction with the state check, so a second press finds it done.
// Invitations follow for every group, as they would without sign-up; each
// group sends in its own transaction, so one that fails leaves the others
// invited and can be sent again from its dashboard.
// Returns {joined, removed, unpairedGroupIds} or {refused: state}.
export function finishSignup(ctx, eventId) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  const result = repo.tx(() => {
    const state = signupState(repo.getEvent(eventId), ctx.now(), ctx.config.tz);
    if (state !== 'closed') return { refused: state };
    let joined = 0;
    let removed = 0;
    const unpairedGroupIds = [];
    for (const group of repo.listGroups(eventId)) {
      const people = repo.listParticipants(group.id);
      // Nobody is paired while sign-up runs, so no giver points at someone
      // removed here.
      for (const p of people.filter((person) => !joins(person))) {
        repo.removeParticipantWithAssignment(p.id, null, now);
        removed += 1;
      }
      const ids = people.filter(joins).map((p) => p.id);
      joined += ids.length;
      if (ids.length >= MIN_GROUP) repo.setAssignment(group.id, makeCycle(ids), now);
      else unpairedGroupIds.push(group.id);
    }
    repo.updateEvent(eventId, { signupDoneAt: now }, now);
    return { joined, removed, unpairedGroupIds };
  });
  if (result.refused) return result;
  // Truncating the WAL keeps the removed people's data out of the log file.
  // The removal has already happened, so a busy database only costs that.
  if (result.removed) {
    try {
      repo.checkpoint();
    } catch (err) {
      ctx.log.warn({ error_class: err?.name ?? typeof err }, 'checkpoint_failed');
    }
  }
  let queued = 0;
  for (const group of repo.listGroups(eventId)) {
    try {
      queued += sendInvitations(ctx, group.id).queued ?? 0;
    } catch (err) {
      ctx.log.error({ group_id: group.id, code: errorCode(err) }, 'invitations_failed');
    }
  }
  if (queued) kickDrain(ctx);
  return result;
}

function signingUp(ctx, participant) {
  return pairingPaused(ctx, ctx.repo.getGroup(participant.groupId));
}

// The sign-up mail once more, for someone who has not answered while sign-up
// is open. Manual, like a reminder sent by hand; it marks someone never
// asked (added with mail off, say) as asked, so the reminders follow.
export function resendSignup(ctx, participantId) {
  const { repo } = ctx;
  if (!mailOn(ctx)) return 'mail-off';
  const now = ctx.nowIso();
  const outcome = repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    const event = repo.getEvent(repo.getGroup(participant.groupId).eventId);
    if (signupState(event, ctx.now(), ctx.config.tz) !== 'open') return 'signup-not-open';
    if (!participant.email) return 'no-email';
    if (participant.signup) return 'signup-answered';
    if (repo.hasQueuedMail(participantId, 'signup')) return 'already-queued';
    if (!participant.signupInvitedAt) repo.updateParticipant(participantId, { signupInvitedAt: now });
    enqueueMail(ctx, participantId, 'signup', now, { manual: true });
    return 'signup-queued';
  });
  if (outcome === 'signup-queued') kickDrain(ctx);
  return outcome;
}

// The organiser's per-participant mail buttons. Each returns the outcome key
// the participant page reports; a queued mail is handed to the drain at once.
// The queued check shares the transaction with the enqueue, so a double tap
// sends one mail.
export function resendInvite(ctx, participantId) {
  const { repo } = ctx;
  if (!mailOn(ctx)) return 'mail-off';
  const now = ctx.nowIso();
  const outcome = repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    // The invitation leads to the draw, which waits for the sign-up.
    if (signingUp(ctx, participant)) return 'signup-active';
    if (!participant.email) return 'no-email';
    if (repo.hasQueuedMail(participantId, 'invite')) return 'already-queued';
    if (!participant.invitedAt) repo.updateParticipant(participantId, { invitedAt: now });
    enqueueMail(ctx, participantId, 'invite', now);
    return 'invite-queued';
  });
  if (outcome === 'invite-queued') kickDrain(ctx);
  return outcome;
}

// Manual reminders are flagged so they do not use up the automatic ones.
export function remindNow(ctx, participantId) {
  const { repo } = ctx;
  if (!mailOn(ctx)) return 'mail-off';
  const outcome = repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    if (signingUp(ctx, participant)) return 'signup-active';
    if (!participant.email) return 'no-email';
    // A reminder before the invitation would be the first mail they get.
    if (!participant.invitedAt) return 'not-invited';
    const group = repo.getGroup(participant.groupId);
    const kind = reminderKind(participant, group, wishForm(repo.getEvent(group.eventId)));
    if (!kind) return 'nothing-to-remind';
    if (repo.hasQueuedMail(participantId, kind)) return 'already-queued';
    enqueueMail(ctx, participantId, kind, ctx.nowIso(), { manual: true });
    return 'remind-queued';
  });
  if (outcome === 'remind-queued') kickDrain(ctx);
  return outcome;
}

export function resendFailed(ctx, participantId) {
  if (!mailOn(ctx)) return 'mail-off';
  if (!ctx.repo.requeueLastFailed(participantId, ctx.nowIso())) return 'no-failure';
  kickDrain(ctx);
  return 'failed-requeued';
}

export function resendGroupFailed(ctx, groupId) {
  if (!mailOn(ctx)) return 'mail-off';
  if (ctx.repo.requeueGroupFailed(groupId, ctx.nowIso()) === 0) return 'no-failure';
  kickDrain(ctx);
  return 'all-requeued';
}
