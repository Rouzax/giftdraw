export class PairingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PairingError';
    this.code = code;
  }
}

const MIN_SIZE = 3;

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

export function makeCycle(ids, rng = Math.random) {
  if (ids.length < MIN_SIZE) throw new PairingError('too-small');
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const map = new Map();
  order.forEach((id, i) => map.set(id, order[(i + 1) % order.length]));
  return map;
}

export function swapReceivers(map, giverA, giverB) {
  const a = map.get(giverA);
  const b = map.get(giverB);
  if (b === giverA || a === giverB) throw new PairingError('self');
  const out = new Map(map);
  out.set(giverA, b);
  out.set(giverB, a);
  return out;
}

export function chooseInsertGiver(map, preferGivers, rng = Math.random) {
  const all = [...map.keys()];
  const preferred = all.filter((id) => preferGivers.has(id));
  return pick(preferred.length > 0 ? preferred : all, rng);
}

export function insertIntoCycle(map, newId, giver) {
  const out = new Map(map);
  out.set(newId, map.get(giver));
  out.set(giver, newId);
  return { map: out, changed: [giver] };
}

export function planRemoval(map, id, preferGivers, rng = Math.random) {
  if (map.size - 1 < MIN_SIZE) throw new PairingError('too-small');
  const receiver = map.get(id);
  const giver = [...map].find(([, r]) => r === id)[0];
  const out = new Map(map);
  out.delete(id);
  if (giver !== receiver) {
    out.set(giver, receiver);
    return { map: out, changed: [giver] };
  }
  // The dropout and `giver` only had each other, so `giver` has no receiver
  // left and is re-inserted into the rest of the cycle.
  out.delete(giver);
  const insertAt = chooseInsertGiver(out, preferGivers, rng);
  const inserted = insertIntoCycle(out, giver, insertAt);
  return { map: inserted.map, changed: [giver, ...inserted.changed] };
}

export function validateAssignment(map, ids) {
  if (map.size !== ids.length) return false;
  const members = new Set(ids);
  const receivers = new Set();
  for (const [giver, receiver] of map) {
    if (!members.has(giver) || !members.has(receiver)) return false;
    if (giver === receiver || receivers.has(receiver)) return false;
    receivers.add(receiver);
  }
  return receivers.size === members.size;
}
