import { chooseInsertGiver, insertIntoCycle, makeCycle, validateAssignment } from './draw/cycle.js';
import { kickDrain } from './mail/outbox.js';
import { assignmentVersion } from './status.js';
import { parseWishesForm, wishOptions } from './wishes.js';

const MIN_GROUP = 3;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PLAN_ROWS_MAX = 500;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const SEPARATOR = /[\t;,]/;

export function saveWishes(ctx, participantId, body) {
  const { repo } = ctx;
  return repo.tx(() => {
    const participant = repo.getParticipant(participantId);
    const event = repo.getEvent(repo.getGroup(participant.groupId).eventId);
    const wishes = parseWishesForm(body, wishOptions(event));
    repo.updateParticipant(participantId, { wishes, wishesUpdatedAt: ctx.nowIso() });
    return wishes;
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

const cut = (value, max) => Array.from(value).slice(0, max).join('');

export function normaliseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

export function parsePasteList(text) {
  const rows = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((original, index) => {
    const line = original.trim();
    if (!line) return;
    const at = line.search(SEPARATOR);
    const name = cut((at === -1 ? line : line.slice(0, at)).trim(), NAME_MAX);
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
  const duplicates = [];
  const planned = rows.map((row, index) => {
    const otherGroupName = row.email ? known.get(row.email.toLowerCase()) : undefined;
    if (otherGroupName !== undefined) duplicates.push({ row: index, otherGroupName });
    return { name: row.name, email: row.email ?? null, insertGiverId: open ? chooseInsertGiver(map, notDrawn) : null };
  });
  const changedGivers = [...new Set(planned.map((r) => r.insertGiverId).filter((id) => id !== null))];
  return { version, rows: planned, duplicates, changedGivers };
}

// The plan comes back from a hidden form field, so every row is checked
// again here rather than trusted.
function cleanPlanRows(plan) {
  if (!plan || typeof plan !== 'object' || typeof plan.version !== 'string') return null;
  if (!Array.isArray(plan.rows) || plan.rows.length === 0 || plan.rows.length > PLAN_ROWS_MAX) return null;
  const rows = [];
  for (const row of plan.rows) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string') return null;
    const name = row.name.trim();
    if (!name || Array.from(name).length > NAME_MAX) return null;
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
    const withLanguage = rows.map(({ name, email }) => ({ name, email, language: event.language }));
    const added = repo.addParticipantsWithAssignment(groupId, withLanguage, (ids) => placeNewcomers(state, rows, ids), now);
    const after = repo.getAssignment(groupId);
    const everyone = [...state.people.map((p) => p.id), ...added.map((p) => p.id)];
    if (after.size > 0 && !validateAssignment(after, everyone)) {
      throw new Error('commitAddParticipants: assignment is not a single valid pairing');
    }
    if (state.open) {
      for (const p of added) {
        if (!p.email) continue;
        repo.updateParticipant(p.id, { invitedAt: now });
        repo.enqueue(p.id, 'invite', now);
        repo.enqueue(p.id, 'draw-open', now);
      }
      for (const giver of state.people) {
        if (giver.drawnAt && giver.email && state.map.get(giver.id) !== after.get(giver.id)) {
          repo.enqueue(giver.id, 'reassigned', now);
        }
      }
    }
    return { added };
  });
  if (result.added) kickDrain(ctx);
  return result;
}

// Runs in one transaction with the invitedAt check, so two overlapping
// presses queue each invitation once. With mail off nobody is marked as
// invited: the organiser shares the links herself.
export function sendInvitations(ctx, groupId) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  return repo.tx(() => {
    let queued = 0;
    if (ctx.mailer.enabled) {
      for (const p of repo.listParticipants(groupId)) {
        if (!p.email || p.invitedAt) continue;
        repo.updateParticipant(p.id, { invitedAt: now });
        repo.enqueue(p.id, 'invite', now);
        queued += 1;
      }
    }
    repo.markInvitationsSent(groupId, now);
    return { queued };
  });
}
