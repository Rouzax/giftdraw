const DAY_MS = 86_400_000;
const formatters = new Map();

function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(date, tz) {
  const parts = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) parts[type] = value;
  return parts;
}

// Wall-clock date ('YYYY-MM-DD') and time ('HH:MM:SS') of an instant in `tz`.
export function localParts(date, tz) {
  const p = wallClock(date, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export function todayIn(now, tz) {
  return localParts(now, tz).date;
}

function offsetAt(utcMs, tz) {
  const p = wallClock(new Date(utcMs), tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// The offset is read twice because the first guess can sit on the other side
// of a daylight-saving change from the target wall-clock time.
export function instantAt(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const guess = wall - offsetAt(wall, tz);
  return new Date(wall - offsetAt(guess, tz));
}

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}
