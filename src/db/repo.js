import { SKIP_CODES } from '../mail/skip-codes.js';
import { newToken } from '../tokens.js';

const JSON_COLUMNS = new Set(['wishes', 'wish_options', 'form_config']);
const BOOLEAN_COLUMNS = new Set(['manual']);

function camel(column) {
  return column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function snake(field) {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toRow(record) {
  if (!record) return null;
  const row = {};
  for (const [column, value] of Object.entries(record)) {
    if (JSON_COLUMNS.has(column)) row[camel(column)] = value === null ? null : JSON.parse(value);
    else if (BOOLEAN_COLUMNS.has(column)) row[camel(column)] = value === 1;
    else row[camel(column)] = value;
  }
  return row;
}

function toRows(records) {
  return records.map(toRow);
}

function toJson(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// Columns each update* method may write. receiver_id and receiver_changed_at
// are deliberately absent from participants: they change only through
// setAssignment so the change timestamp can never drift from the pairing.
const UPDATABLE = {
  events: new Set(['name', 'language', 'cleanupWeeks', 'themeText', 'wishOptions', 'formConfig']),
  groups: new Set(['name', 'exchangeDate', 'exchangeTime', 'exchangePlace', 'autoOpenAt']),
  participants: new Set([
    'name', 'email', 'language', 'token', 'wishes', 'wishesUpdatedAt', 'invitedAt',
    'visitedAt', 'drawnAt', 'printedAt', 'notifyGiverDueAt',
  ]),
};

const STORE_AS_JSON = new Set(['wishes', 'wishOptions', 'formConfig']);

// A given-up row `o` the organiser can send again. Any later row of the same
// kind for that person supersedes it, whatever its status: a later failure
// is the one to resend, and a later sent or queued mail already did the job.
// A skipped row would only be skipped again.
const RESENDABLE = `o.status IN ('failed', 'gaveup')
  AND ifnull(o.error_code, '') NOT IN (${SKIP_CODES.map((code) => `'${code}'`).join(', ')})
  AND NOT EXISTS (SELECT 1 FROM outbox later
                  WHERE later.participant_id = o.participant_id AND later.kind = o.kind AND later.id > o.id)`;

function defaultNow(now) {
  return now ?? new Date().toISOString();
}

export function createRepo(db) {
  let depth = 0;

  function tx(fn) {
    if (depth > 0) return fn();
    // IMMEDIATE takes the write lock up front, so a read-then-write inside
    // fn cannot fail halfway on a lock upgrade.
    db.exec('BEGIN IMMEDIATE');
    depth += 1;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        throw new Error('repo.tx callback must be synchronous');
      }
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      depth -= 1;
    }
  }

  function update(table, id, fields) {
    const allowed = UPDATABLE[table];
    const columns = [];
    const values = [];
    for (const [field, value] of Object.entries(fields)) {
      if (!allowed.has(field)) throw new Error(`${table}: field ${field} cannot be updated`);
      if (value === undefined) continue;
      columns.push(`${snake(field)} = ?`);
      values.push(STORE_AS_JSON.has(field) ? toJson(value) : value);
    }
    if (columns.length === 0) return;
    db.prepare(`UPDATE ${table} SET ${columns.join(', ')} WHERE id = ?`).run(...values, id);
  }

  const one = (sql, ...params) => toRow(db.prepare(sql).get(...params));
  const many = (sql, ...params) => toRows(db.prepare(sql).all(...params));

  // Events

  function createEvent({ name, language, cleanupWeeks = 4, themeText = null, wishOptions = null }, now) {
    const result = db
      .prepare(`INSERT INTO events (name, language, cleanup_weeks, theme_text, wish_options, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(name, language, cleanupWeeks, themeText, toJson(wishOptions), defaultNow(now));
    return Number(result.lastInsertRowid);
  }

  // A printed card shows the theme, the wish form's sections and the
  // exchange date, time and place, so the update records when any of those
  // really changed; the card is then out of date. Saving the same values
  // again leaves the time alone. JSON fields compare by content.
  function changedAt(table, id, fields, cardFields, column, now) {
    tx(() => {
      const before = one(`SELECT * FROM ${table} WHERE id = ?`, id);
      update(table, id, fields);
      if (!before) return;
      const changed = cardFields.some((field) => fields[field] !== undefined && toJson(fields[field]) !== toJson(before[field]));
      if (changed) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(defaultNow(now), id);
    });
  }

  const getEvent = (id) => one('SELECT * FROM events WHERE id = ?', id);
  const listEvents = () => many('SELECT * FROM events ORDER BY id');
  // theme_changed_at stands for any change to the event's text on the card.
  const updateEvent = (id, fields, now) =>
    changedAt('events', id, fields, ['themeText', 'formConfig'], 'theme_changed_at', now);
  const deleteEvent = (id) => db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;

  // Groups

  function createGroup(eventId, { name, exchangeDate, exchangeTime = null, exchangePlace = null, autoOpenAt = null }, now) {
    const result = db
      .prepare(`INSERT INTO groups (event_id, name, exchange_date, exchange_time, exchange_place, auto_open_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, name, exchangeDate, exchangeTime, exchangePlace, autoOpenAt, defaultNow(now));
    return Number(result.lastInsertRowid);
  }

  const getGroup = (id) => one('SELECT * FROM groups WHERE id = ?', id);
  const listGroups = (eventId) => many('SELECT * FROM groups WHERE event_id = ? ORDER BY id', eventId);
  const latestGroup = (eventId) =>
    one('SELECT * FROM groups WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', eventId);
  const updateGroup = (id, fields, now) =>
    changedAt('groups', id, fields, ['exchangeDate', 'exchangeTime', 'exchangePlace'], 'details_changed_at', now);
  const deleteGroup = (id) => db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes > 0;

  // The IS NULL guard makes opening idempotent: when the button and the
  // auto-open tick race, exactly one caller sees true and sends the mails.
  const markGroupOpened = (id, now) =>
    db.prepare('UPDATE groups SET opened_at = ? WHERE id = ? AND opened_at IS NULL').run(now, id).changes === 1;

  function markInvitationsSent(id, now) {
    db.prepare('UPDATE groups SET invitations_sent_at = ? WHERE id = ?').run(now, id);
  }

  // Participants

  const getParticipant = (id) => one('SELECT * FROM participants WHERE id = ?', id);
  const getParticipantByToken = (token) => one('SELECT * FROM participants WHERE token = ?', token);
  const listParticipants = (groupId) => many('SELECT * FROM participants WHERE group_id = ? ORDER BY id', groupId);
  const listAllParticipants = () => many('SELECT * FROM participants ORDER BY id');
  const updateParticipant = (id, fields) => update('participants', id, fields);
  const giverOf = (participantId) => one('SELECT * FROM participants WHERE receiver_id = ?', participantId);

  function findEmailInEvent(eventId, email, exceptId) {
    return one(
      `SELECT p.* FROM participants p JOIN groups g ON g.id = p.group_id
       WHERE g.event_id = ? AND p.email IS NOT NULL AND lower(p.email) = lower(?) AND p.id IS NOT ?
       ORDER BY p.id LIMIT 1`,
      eventId, email, exceptId ?? null,
    );
  }

  function getAssignment(groupId) {
    const pairs = db
      .prepare('SELECT id, receiver_id FROM participants WHERE group_id = ? AND receiver_id IS NOT NULL ORDER BY id')
      .all(groupId);
    return new Map(pairs.map((p) => [p.id, p.receiver_id]));
  }

  // Writes the whole group's pairing: givers missing from map (or every giver
  // when map is null) end up without a receiver. receiver_changed_at moves
  // only for givers whose receiver actually differs, because it drives the
  // "printed card out of date" warning.
  function setAssignment(groupId, map, now) {
    tx(() => {
      const current = db.prepare('SELECT id, receiver_id FROM participants WHERE group_id = ?').all(groupId);
      const members = new Set(current.map((p) => p.id));
      if (map) {
        for (const [giver, receiver] of map) {
          if (!members.has(giver) || !members.has(receiver)) {
            throw new Error(`setAssignment: pair ${giver} -> ${receiver} is not within group ${groupId}`);
          }
        }
      }
      const write = db.prepare('UPDATE participants SET receiver_id = ?, receiver_changed_at = ? WHERE id = ?');
      for (const { id, receiver_id: before } of current) {
        const after = map?.get(id) ?? null;
        if (after !== before) write.run(after, now, id);
      }
    });
  }

  function addParticipantsWithAssignment(groupId, rows, assign, now) {
    return tx(() => {
      const insert = db.prepare(
        `INSERT INTO participants (group_id, name, email, language, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const added = rows.map(({ name, email = null, language }) =>
        Number(insert.run(groupId, name, email, language, newToken(), now).lastInsertRowid));
      const ids = db.prepare('SELECT id FROM participants WHERE group_id = ? ORDER BY id').all(groupId).map((p) => p.id);
      setAssignment(groupId, assign(ids), now);
      return added.map(getParticipant);
    });
  }

  // The new pairing is written before the delete, and a map that still points
  // a giver at the removed participant is refused: ON DELETE SET NULL would
  // otherwise leave that giver silently without a receiver.
  function removeParticipantWithAssignment(id, map, now) {
    tx(() => {
      const participant = getParticipant(id);
      if (!participant) return;
      const rest = map ? new Map([...map].filter(([giver]) => giver !== id)) : null;
      if (rest && [...rest.values()].includes(id)) {
        throw new Error(`removeParticipantWithAssignment: map still gives to participant ${id}`);
      }
      setAssignment(participant.groupId, rest, now);
      db.prepare('DELETE FROM participants WHERE id = ?').run(id);
    });
  }

  // Outbox

  function enqueue(participantId, kind, now, { manual = false } = {}) {
    const result = db
      .prepare(`INSERT INTO outbox (participant_id, kind, manual, status, next_attempt_at, created_at)
                VALUES (?, ?, ?, 'pending', ?, ?)`)
      .run(participantId, kind, manual ? 1 : 0, now, now);
    return Number(result.lastInsertRowid);
  }

  // While a row is 'sending', next_attempt_at holds the claim time so
  // requeueStale can tell a crashed send from a running one.
  function claimDue(now, limit) {
    return tx(() => {
      const ids = db
        .prepare(`SELECT id FROM outbox WHERE status = 'pending' AND next_attempt_at <= ?
                  ORDER BY next_attempt_at, id LIMIT ?`)
        .all(now, limit)
        .map((r) => r.id);
      const claim = db.prepare(
        `UPDATE outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = ? WHERE id = ?`,
      );
      for (const id of ids) claim.run(now, id);
      return ids.map((id) => one('SELECT * FROM outbox WHERE id = ?', id));
    });
  }

  function markSent(id, now) {
    db.prepare(`UPDATE outbox SET status = 'sent', sent_at = ?, error_code = NULL WHERE id = ?`).run(now, id);
  }

  // A retry goes back to 'pending' so claimDue picks it up at nextAttemptAt
  // and reminderHistory keeps counting it. Giving up stores the time of the
  // final failure in next_attempt_at, which mailStatus reports.
  function markFailed(id, errorCode, nextAttemptAt, now) {
    const status = nextAttemptAt === null ? 'gaveup' : 'pending';
    db.prepare('UPDATE outbox SET status = ?, error_code = ?, next_attempt_at = ? WHERE id = ?')
      .run(status, errorCode, nextAttemptAt ?? now, id);
  }

  function requeueStale(olderThan) {
    return db
      .prepare(`UPDATE outbox SET status = 'pending' WHERE status = 'sending' AND next_attempt_at < ?`)
      .run(olderThan).changes;
  }

  // Only safe while no drain can be running, i.e. at startup.
  function requeueAllSending() {
    return db.prepare(`UPDATE outbox SET status = 'pending' WHERE status = 'sending'`).run().changes;
  }

  function hasQueuedMail(participantId, kind) {
    return db
      .prepare(`SELECT 1 FROM outbox WHERE participant_id = ? AND kind = ? AND status IN ('pending', 'sending') LIMIT 1`)
      .get(participantId, kind) !== undefined;
  }

  function reminderHistory(participantId, kind) {
    const row = db
      .prepare(`SELECT
                  count(*) FILTER (WHERE status IN ('pending', 'sending', 'sent')) AS count,
                  max(created_at) AS last_at
                FROM outbox WHERE participant_id = ? AND kind = ? AND manual = 0`)
      .get(participantId, kind);
    return { count: row.count, lastAt: row.last_at };
  }

  // A failure that is still being retried is a pending (or, mid-attempt,
  // sending) row that kept its error_code; its `at` is then the next attempt
  // (the claim time while sending) rather than the time it gave up. A
  // reminder dropped because it no longer applied is no failure.
  function inviteState(row) {
    if (!row) return null;
    if (row.status === 'sent') return 'sent';
    if (row.status === 'gaveup' || row.status === 'failed') return 'failed';
    return row.error_code ? 'retrying' : 'queued';
  }

  function mailStatus(participantId) {
    const reminder = db
      .prepare(`SELECT max(created_at) AS at FROM outbox
                WHERE participant_id = ? AND kind LIKE 'remind-%' AND status IN ('pending', 'sending', 'sent')`)
      .get(participantId);
    const failure = db
      .prepare(`SELECT kind, status, error_code, next_attempt_at FROM outbox o
                WHERE participant_id = ? AND ((${RESENDABLE})
                  OR (status IN ('pending', 'sending') AND error_code IS NOT NULL))
                ORDER BY id DESC LIMIT 1`)
      .get(participantId);
    const pending = db
      .prepare(`SELECT count(*) AS n FROM outbox WHERE participant_id = ? AND status IN ('pending', 'sending')`)
      .get(participantId);
    const invite = db
      .prepare(`SELECT status, error_code FROM outbox WHERE participant_id = ? AND kind = 'invite'
                ORDER BY id DESC LIMIT 1`)
      .get(participantId);
    return {
      lastReminderAt: reminder.at,
      lastFailure: failure
        ? {
          kind: failure.kind,
          errorCode: failure.error_code,
          at: failure.next_attempt_at,
          retrying: failure.status === 'pending' || failure.status === 'sending',
        }
        : null,
      pendingCount: pending.n,
      invite: inviteState(invite),
    };
  }

  // attempts restarts so the drain's backoff schedule applies afresh.
  function requeueLastFailed(participantId, now) {
    return tx(() => {
      const row = db
        .prepare(`SELECT id FROM outbox o WHERE participant_id = ? AND ${RESENDABLE}
                  ORDER BY id DESC LIMIT 1`)
        .get(participantId);
      if (!row) return false;
      db.prepare(`UPDATE outbox SET status = 'pending', attempts = 0, error_code = NULL, next_attempt_at = ?
                  WHERE id = ?`).run(now, row.id);
      return true;
    });
  }

  const GIVEN_UP_IN_GROUP = `SELECT o.id FROM outbox o WHERE ${RESENDABLE}
    AND o.participant_id IN (SELECT id FROM participants WHERE group_id = ?)`;

  const countGivenUp = (groupId) =>
    db.prepare(`SELECT count(*) AS n FROM (${GIVEN_UP_IN_GROUP})`).get(groupId).n;

  // As requeueLastFailed, for every given-up mail of the group at once.
  function requeueGroupFailed(groupId, now) {
    return db
      .prepare(`UPDATE outbox SET status = 'pending', attempts = 0, error_code = NULL, next_attempt_at = ?
                WHERE id IN (${GIVEN_UP_IN_GROUP})`)
      .run(now, groupId).changes;
  }

  // Maintenance

  function deleteExpiredGroups(todayIso) {
    return db
      .prepare(`DELETE FROM groups WHERE id IN (
                  SELECT g.id FROM groups g JOIN events e ON e.id = g.event_id
                  WHERE date(g.exchange_date, '+' || (e.cleanup_weeks * 7) || ' days') < ?)`)
      .run(todayIso).changes;
  }

  function ping() {
    return db.prepare('SELECT 1 AS one').get().one === 1;
  }

  function checkpoint() {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  return {
    tx,
    createEvent, getEvent, listEvents, updateEvent, deleteEvent,
    createGroup, getGroup, listGroups, latestGroup, updateGroup, deleteGroup, markGroupOpened, markInvitationsSent,
    getParticipant, getParticipantByToken, listParticipants, listAllParticipants, updateParticipant,
    findEmailInEvent, giverOf,
    addParticipantsWithAssignment, removeParticipantWithAssignment, setAssignment, getAssignment,
    enqueue, hasQueuedMail, claimDue, markSent, markFailed, requeueStale, requeueAllSending, reminderHistory, mailStatus,
    requeueLastFailed, countGivenUp, requeueGroupFailed, deleteExpiredGroups, checkpoint, ping,
  };
}
