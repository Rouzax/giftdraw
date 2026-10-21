// Fixed-window counters per key. Pruning runs on the caller's clock, at most
// once per window, so there is no timer to stop and tests can drive time.
export function createLimiter({ limit, windowMs }) {
  const windows = new Map();
  let lastPrune = -Infinity;

  function prune(now) {
    if (now - lastPrune < windowMs) return;
    lastPrune = now;
    for (const [key, entry] of windows) {
      if (now - entry.start >= windowMs) windows.delete(key);
    }
  }

  function current(key, now) {
    const entry = windows.get(key);
    return entry && now - entry.start < windowMs ? entry : null;
  }

  // True while the key is still within the limit, counting this hit.
  function hit(key, now) {
    prune(now);
    let entry = current(key, now);
    if (!entry) {
      entry = { start: now, count: 0 };
      windows.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  function blocked(key, now) {
    const entry = current(key, now);
    return Boolean(entry) && entry.count >= limit;
  }

  return { hit, blocked, size: () => windows.size };
}
