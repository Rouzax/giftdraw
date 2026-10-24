import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/open.js';
import { createRepo } from '../src/db/repo.js';

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-02T10:00:00.000Z';
const T2 = '2026-11-03T10:00:00.000Z';

function setup() {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const eventId = repo.createEvent({ name: 'Family', language: 'nl' }, T0);
  const groupId = repo.createGroup(eventId, { name: 'Home', exchangeDate: '2026-12-20', autoOpenAt: null }, T0);
  return { db, repo, eventId, groupId };
}

function people(...names) {
  return names.map((name) => ({ name, email: `${name.toLowerCase()}@example.com`, language: 'nl' }));
}

// Givers in id order each give to the next one, the last to the first.
function ring(ids) {
  const sorted = [...ids].sort((a, b) => a - b);
  return new Map(sorted.map((id, i) => [id, sorted[(i + 1) % sorted.length]]));
}

test('event round trip', () => {
  const { repo, eventId } = setup();
  const event = repo.getEvent(eventId);
  assert.deepEqual(event, {
    id: eventId,
    name: 'Family',
    language: 'nl',
    cleanupWeeks: 4,
    themeText: null,
    wishOptions: null,
    themeChangedAt: null,
    createdAt: T0,
    formConfig: null,
  });
  const options = [{ id: 'book', label: 'A book', detail: null }];
  repo.updateEvent(eventId, { name: 'Friends', cleanupWeeks: 6, themeText: null }, T1);
  assert.equal(repo.getEvent(eventId).themeChangedAt, null, 'an unchanged theme keeps no change time');
  repo.updateEvent(eventId, { wishOptions: options }, T1);
  assert.equal(repo.getEvent(eventId).themeChangedAt, T1, 'the choices are on the card');
  repo.updateEvent(eventId, { themeText: 'Regift' }, T2);
  assert.equal(repo.getEvent(eventId).themeChangedAt, T2);
  const updated = repo.getEvent(eventId);
  assert.equal(updated.name, 'Friends');
  assert.equal(updated.cleanupWeeks, 6);
  assert.equal(updated.themeText, 'Regift');
  assert.deepEqual(updated.wishOptions, options);
  repo.updateEvent(eventId, { wishOptions: null });
  assert.equal(repo.getEvent(eventId).wishOptions, null);
  assert.deepEqual(repo.listEvents().map((e) => e.id), [eventId]);
  assert.throws(() => repo.updateEvent(eventId, { createdAt: T1 }), /createdAt/);
  repo.deleteEvent(eventId);
  assert.equal(repo.getEvent(eventId), null);
});

test('formConfig round-trips as JSON and a real change marks the card text changed', () => {
  const { repo, eventId } = setup();
  const config = { sections: { pets: { show: false } } };
  repo.updateEvent(eventId, { formConfig: config }, T1);
  assert.deepEqual(repo.getEvent(eventId).formConfig, config);
  assert.equal(repo.getEvent(eventId).themeChangedAt, T1);
  repo.updateEvent(eventId, { formConfig: { sections: { pets: { show: false } } } }, T2);
  assert.equal(repo.getEvent(eventId).themeChangedAt, T1, 'an equal config is no change');
  repo.updateEvent(eventId, { formConfig: null }, T2);
  assert.equal(repo.getEvent(eventId).formConfig, null);
  assert.equal(repo.getEvent(eventId).themeChangedAt, T2);
});

test('group round trip', () => {
  const { repo, eventId, groupId } = setup();
  assert.equal(typeof groupId, 'number');
  assert.deepEqual(repo.getGroup(groupId), {
    id: groupId,
    eventId,
    name: 'Home',
    exchangeDate: '2026-12-20',
    exchangeTime: null,
    exchangePlace: null,
    autoOpenAt: null,
    openedAt: null,
    invitationsSentAt: null,
    detailsChangedAt: null,
    createdAt: T0,
  });
  const second = repo.createGroup(eventId, { name: 'Work', exchangeDate: '2026-12-18', autoOpenAt: '2026-12-01' }, T1);
  assert.deepEqual(repo.listGroups(eventId).map((g) => g.id), [groupId, second]);
  assert.equal(repo.latestGroup(eventId).id, second);
  repo.updateGroup(groupId, { name: 'House', autoOpenAt: '2026-12-05' });
  assert.equal(repo.getGroup(groupId).name, 'House');
  assert.equal(repo.getGroup(groupId).autoOpenAt, '2026-12-05');
  assert.throws(() => repo.updateGroup(groupId, { openedAt: T1 }), /openedAt/);
  assert.equal(repo.getGroup(groupId).detailsChangedAt, null, 'name and auto-open are not on the card');
  repo.updateGroup(groupId, { exchangeDate: '2026-12-20', exchangeTime: null }, T1);
  assert.equal(repo.getGroup(groupId).detailsChangedAt, null, 'the same details again are no change');
  repo.updateGroup(groupId, { exchangeTime: '10:30', exchangePlace: 'Studio' }, T2);
  assert.equal(repo.getGroup(groupId).detailsChangedAt, T2);
  assert.equal(repo.getGroup(groupId).exchangeTime, '10:30');
  assert.equal(repo.getGroup(groupId).exchangePlace, 'Studio');
  const third = repo.createGroup(eventId, {
    name: 'Club', exchangeDate: '2026-12-19', exchangeTime: '19:45', exchangePlace: 'Hall 2',
  }, T1);
  assert.equal(repo.getGroup(third).exchangeTime, '19:45');
  assert.equal(repo.getGroup(third).exchangePlace, 'Hall 2');
  repo.markInvitationsSent(groupId, T1);
  assert.equal(repo.getGroup(groupId).invitationsSentAt, T1);
  repo.deleteGroup(second);
  assert.equal(repo.getGroup(second), null);
});

test('markGroupOpened returns true then false', () => {
  const { repo, groupId } = setup();
  assert.equal(repo.markGroupOpened(groupId, T1), true);
  assert.equal(repo.markGroupOpened(groupId, T2), false);
  assert.equal(repo.getGroup(groupId).openedAt, T1);
});

test('participant round trip', () => {
  const { repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  assert.equal(ada.groupId, groupId);
  assert.equal(ada.name, 'Ada');
  assert.equal(ada.email, 'ada@example.com');
  assert.equal(ada.language, 'nl');
  assert.match(ada.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ada.receiverId, null);
  assert.equal(ada.receiverChangedAt, null);
  assert.equal(ada.wishes, null);
  assert.equal(ada.createdAt, T0);

  const wishes = { options: ['book'], note: 'Something to read' };
  repo.updateParticipant(ada.id, { name: 'Ada B', email: null, wishes, wishesUpdatedAt: T1, drawnAt: T2 });
  const updated = repo.getParticipant(ada.id);
  assert.equal(updated.name, 'Ada B');
  assert.equal(updated.email, null);
  assert.deepEqual(updated.wishes, wishes);
  assert.equal(updated.wishesUpdatedAt, T1);
  assert.equal(updated.drawnAt, T2);
  assert.deepEqual(repo.getParticipantByToken(ada.token), updated);
  assert.equal(repo.getParticipantByToken('nope'), null);
  assert.deepEqual(repo.listParticipants(groupId), [updated]);
  assert.deepEqual(repo.listAllParticipants(), [updated]);
});

test('updateParticipant refuses fields outside the allowlist', () => {
  const { repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  assert.throws(() => repo.updateParticipant(ada.id, { receiverId: 1 }), /receiverId/);
  assert.throws(() => repo.updateParticipant(ada.id, { receiverChangedAt: T1 }), /receiverChangedAt/);
  assert.throws(() => repo.updateParticipant(ada.id, { name: 'X', groupId: 2 }), /groupId/);
  assert.equal(repo.getParticipant(ada.id).name, 'Ada');
});

test('addParticipantsWithAssignment writes the assignment from all ids', () => {
  const { repo, groupId } = setup();
  repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben'), () => null, T0);
  let seen;
  const added = repo.addParticipantsWithAssignment(groupId, people('Cor'), (ids) => {
    seen = ids;
    return ring(ids);
  }, T1);
  assert.equal(added.length, 1);
  assert.equal(seen.length, 3);
  assert.deepEqual(repo.getAssignment(groupId), ring(seen));
  assert.equal(added[0].receiverId, ring(seen).get(added[0].id));
});

test('addParticipantsWithAssignment with a throwing assign leaves no new participants', () => {
  const { repo, groupId } = setup();
  repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben', 'Cor'), ring, T0);
  const before = repo.listParticipants(groupId);
  assert.throws(() => repo.addParticipantsWithAssignment(groupId, people('Dirk', 'Eva'), () => {
    throw new Error('no cycle');
  }, T1), /no cycle/);
  assert.deepEqual(repo.listParticipants(groupId), before);
});

test('removeParticipantWithAssignment of a receiver succeeds when the map repoints the giver', () => {
  const { repo, groupId } = setup();
  const [ada, ben, cor, dirk] = repo.addParticipantsWithAssignment(
    groupId, people('Ada', 'Ben', 'Cor', 'Dirk'), ring, T0,
  );
  // Ada gives to Ben; removing Ben repoints Ada to Cor.
  assert.equal(repo.getParticipant(ada.id).receiverId, ben.id);
  const map = new Map([[ada.id, cor.id], [cor.id, dirk.id], [dirk.id, ada.id]]);
  repo.removeParticipantWithAssignment(ben.id, map, T1);
  assert.equal(repo.getParticipant(ben.id), null);
  assert.deepEqual(repo.getAssignment(groupId), map);
  assert.equal(repo.getParticipant(ada.id).receiverChangedAt, T1);
  assert.equal(repo.getParticipant(cor.id).receiverChangedAt, T0);
});

test('removeParticipantWithAssignment refuses a map that still gives to the removed participant', () => {
  const { repo, groupId } = setup();
  const [ada, ben, cor] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben', 'Cor'), ring, T0);
  assert.throws(() => repo.removeParticipantWithAssignment(ben.id, ring([ada.id, ben.id, cor.id]), T1), /gives to/);
  assert.equal(repo.listParticipants(groupId).length, 3);
});

test('removeParticipantWithAssignment with null clears the assignment', () => {
  const { repo, groupId } = setup();
  const [, ben] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben', 'Cor'), ring, T0);
  repo.removeParticipantWithAssignment(ben.id, null, T1);
  assert.equal(repo.getAssignment(groupId).size, 0);
  assert.equal(repo.listParticipants(groupId).length, 2);
});

test('setAssignment changing two givers sets receiverChangedAt on exactly those two', () => {
  const { repo, groupId } = setup();
  const [ada, ben, cor, dirk] = repo.addParticipantsWithAssignment(
    groupId, people('Ada', 'Ben', 'Cor', 'Dirk'), () => null, T0,
  );
  repo.setAssignment(groupId, ring([ada.id, ben.id, cor.id, dirk.id]), T1);
  // Swap the receivers of Ada and Cor: Ada -> Dirk, Cor -> Ben.
  const swapped = new Map([[ada.id, dirk.id], [ben.id, cor.id], [cor.id, ben.id], [dirk.id, ada.id]]);
  repo.setAssignment(groupId, swapped, T2);
  const changed = repo.listParticipants(groupId).filter((p) => p.receiverChangedAt === T2).map((p) => p.id);
  assert.deepEqual(changed, [ada.id, cor.id]);
  assert.deepEqual(repo.getAssignment(groupId), swapped);
  assert.equal(repo.giverOf(dirk.id).id, ada.id);

  repo.setAssignment(groupId, null, T2);
  assert.equal(repo.getAssignment(groupId).size, 0);
  assert.equal(repo.giverOf(dirk.id), null);
});

test('setAssignment refuses a receiver outside the group', () => {
  const { repo, eventId, groupId } = setup();
  const [ada, ben, cor] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben', 'Cor'), () => null, T0);
  const other = repo.createGroup(eventId, { name: 'Work', exchangeDate: '2026-12-18', autoOpenAt: null }, T0);
  const [eva] = repo.addParticipantsWithAssignment(other, people('Eva'), () => null, T0);
  assert.throws(() => repo.setAssignment(groupId, new Map([[ada.id, eva.id], [ben.id, cor.id], [cor.id, ada.id]]), T1));
  assert.equal(repo.getAssignment(groupId).size, 0);
});

test('deleteGroup cascades to participants and outbox', () => {
  const { db, repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben', 'Cor'), ring, T0);
  repo.enqueue(ada.id, 'invite', T0);
  repo.deleteGroup(groupId);
  assert.equal(db.prepare('SELECT count(*) AS n FROM participants').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM outbox').get().n, 0);
});

test('findEmailInEvent matches case-insensitively across groups of one event only', () => {
  const { repo, eventId, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  const sibling = repo.createGroup(eventId, { name: 'Work', exchangeDate: '2026-12-18', autoOpenAt: null }, T0);
  const [ben] = repo.addParticipantsWithAssignment(sibling, people('Ben'), () => null, T0);
  const otherEvent = repo.createEvent({ name: 'Club', language: 'en' }, T0);
  const otherGroup = repo.createGroup(otherEvent, { name: 'Club', exchangeDate: '2026-12-10', autoOpenAt: null }, T0);

  assert.equal(repo.findEmailInEvent(eventId, 'ADA@example.com', ben.id).id, ada.id);
  assert.equal(repo.findEmailInEvent(eventId, 'ADA@example.com', ada.id), null);
  assert.equal(repo.findEmailInEvent(otherEvent, 'ADA@example.com', null), null);
  repo.addParticipantsWithAssignment(otherGroup, people('Cor'), () => null, T0);
  assert.equal(repo.findEmailInEvent(otherEvent, 'ada@example.com', null), null);
});

test('tx rolls back on error and nested calls join the outer transaction', () => {
  const { repo, groupId } = setup();
  assert.throws(() => repo.tx(() => {
    repo.updateGroup(groupId, { name: 'Changed' });
    repo.tx(() => repo.markGroupOpened(groupId, T1));
    throw new Error('abort');
  }), /abort/);
  assert.equal(repo.getGroup(groupId).name, 'Home');
  assert.equal(repo.getGroup(groupId).openedAt, null);
  assert.equal(repo.tx(() => 42), 42);
});

test('claimDue does not return a row twice', () => {
  const { repo, groupId } = setup();
  const [ada, ben] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben'), () => null, T0);
  const first = repo.enqueue(ada.id, 'invite', T0);
  repo.enqueue(ben.id, 'invite', T2);
  const claimed = repo.claimDue(T1, 10);
  assert.deepEqual(claimed.map((r) => r.id), [first]);
  assert.equal(claimed[0].status, 'sending');
  assert.equal(claimed[0].participantId, ada.id);
  assert.equal(claimed[0].kind, 'invite');
  assert.equal(claimed[0].manual, false);
  assert.deepEqual(repo.claimDue(T1, 10), []);
  assert.equal(repo.claimDue(T2, 1).length, 1);
  assert.deepEqual(repo.claimDue(T2, 10), []);
});

test('markFailed retries or gives up, markSent and requeueLastFailed', () => {
  const { repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  const id = repo.enqueue(ada.id, 'invite', T0);
  repo.claimDue(T0, 10);
  repo.markFailed(id, 'ECONNREFUSED', T1, T0);
  assert.deepEqual(repo.mailStatus(ada.id), {
    lastReminderAt: null,
    lastFailure: { kind: 'invite', errorCode: 'ECONNREFUSED', at: T1, retrying: true },
    pendingCount: 1,
    invite: 'retrying',
  });
  assert.deepEqual(repo.claimDue(T0, 10), []);
  const [retry] = repo.claimDue(T1, 10);
  assert.equal(retry.id, id);
  assert.equal(retry.attempts, 2);
  repo.markFailed(id, 'smtp-550', null, T1);
  assert.deepEqual(repo.claimDue(T2, 10), []);
  assert.deepEqual(repo.mailStatus(ada.id), {
    lastReminderAt: null,
    lastFailure: { kind: 'invite', errorCode: 'smtp-550', at: T1, retrying: false },
    pendingCount: 0,
    invite: 'failed',
  });

  assert.equal(repo.requeueLastFailed(ada.id, T2), true);
  assert.equal(repo.mailStatus(ada.id).lastFailure, null);
  assert.equal(repo.mailStatus(ada.id).pendingCount, 1);
  assert.equal(repo.mailStatus(ada.id).invite, 'queued');
  const [again] = repo.claimDue(T2, 10);
  assert.equal(again.id, id);
  repo.markSent(again.id, T2);
  assert.equal(repo.mailStatus(ada.id).invite, 'sent');
  assert.equal(repo.requeueLastFailed(ada.id, T2), false);
  assert.equal(repo.mailStatus(ada.id).pendingCount, 0);
});

test('requeueStale returns old sending rows to pending', () => {
  const { repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  const id = repo.enqueue(ada.id, 'invite', T0);
  repo.claimDue(T1, 10);
  assert.equal(repo.requeueStale(T1), 0);
  assert.equal(repo.requeueStale(T2), 1);
  assert.deepEqual(repo.claimDue(T2, 10).map((r) => r.id), [id]);
});

test('reminderHistory ignores manual and failed rows', () => {
  const { repo, groupId } = setup();
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  repo.enqueue(ada.id, 'remind-wishes', T0);
  const failed = repo.enqueue(ada.id, 'remind-wishes', T1);
  repo.enqueue(ada.id, 'remind-wishes', T2, { manual: true });
  repo.enqueue(ada.id, 'remind-draw', T2);
  repo.claimDue(T1, 1);
  repo.claimDue(T1, 1);
  repo.markFailed(failed, 'error', null, T1);
  assert.deepEqual(repo.reminderHistory(ada.id, 'remind-wishes'), { count: 1, lastAt: T1 });
  assert.deepEqual(repo.reminderHistory(ada.id, 'remind-draw'), { count: 1, lastAt: T2 });
  assert.deepEqual(repo.reminderHistory(ada.id, 'invite'), { count: 0, lastAt: null });
  assert.equal(repo.mailStatus(ada.id).lastReminderAt, T2);
});

test('deleteExpiredGroups uses each event cleanupWeeks', () => {
  const { repo, eventId, groupId } = setup();
  const longEvent = repo.createEvent({ name: 'Club', language: 'en', cleanupWeeks: 6 }, T0);
  const longGroup = repo.createGroup(longEvent, { name: 'Club', exchangeDate: '2026-12-20', autoOpenAt: null }, T0);
  const [ada] = repo.addParticipantsWithAssignment(groupId, people('Ada'), () => null, T0);
  repo.enqueue(ada.id, 'invite', T0);

  // 2026-12-20 plus 4 weeks is 2027-01-17.
  assert.equal(repo.deleteExpiredGroups('2027-01-17'), 0);
  assert.equal(repo.deleteExpiredGroups('2027-01-18'), 1);
  assert.equal(repo.getGroup(groupId), null);
  assert.equal(repo.getParticipant(ada.id), null);
  assert.notEqual(repo.getEvent(eventId), null);
  assert.notEqual(repo.getGroup(longGroup), null);
  assert.equal(repo.deleteExpiredGroups('2027-02-01'), 1);
  repo.checkpoint();
});

test('requeueAllSending returns every sending row to pending', () => {
  const { repo, groupId } = setup();
  const [ada, ben] = repo.addParticipantsWithAssignment(groupId, people('Ada', 'Ben'), () => null, T0);
  repo.enqueue(ada.id, 'invite', T0);
  repo.claimDue(T2, 10);
  repo.enqueue(ben.id, 'invite', T2);
  assert.equal(repo.requeueAllSending(), 1);
  assert.equal(repo.claimDue(T2, 10).length, 2);
});

test('ping runs a trivial query', () => {
  const { repo, db } = setup();
  assert.equal(repo.ping(), true);
  db.close();
  assert.throws(() => repo.ping());
});
