export type RepeatRule = { frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string; occurrences?: number };

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)])) as Record<string, number>;
}

function fromZonedParts(parts: Record<string, number>, timeZone: string) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += target - actualAsUtc;
  }
  return new Date(guess);
}

/** Advances local wall-clock time in the series timezone, preserving it across DST changes. */
export function nextOccurrence(previousAt: Date, rule: RepeatRule) {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) throw new Error("invalid_repeat_interval");
  try { new Intl.DateTimeFormat("en", { timeZone: rule.timeZone }); } catch { throw new Error("invalid_repeat_timezone"); }
  const p = zonedParts(previousAt, rule.timeZone);
  if (rule.frequency === "daily") {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + rule.interval));
    p.year = date.getUTCFullYear(); p.month = date.getUTCMonth() + 1; p.day = date.getUTCDate();
  } else if (rule.frequency === "weekly") {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + 7 * rule.interval));
    p.year = date.getUTCFullYear(); p.month = date.getUTCMonth() + 1; p.day = date.getUTCDate();
  } else if (rule.frequency === "monthly") {
    const month = p.month - 1 + rule.interval;
    const year = p.year + Math.floor(month / 12);
    const monthIndex = month % 12;
    p.year = year; p.month = monthIndex + 1;
    p.day = Math.min(p.day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
  } else {
    throw new Error("invalid_repeat_frequency");
  }
  return fromZonedParts(p, rule.timeZone);
}

export function occurrenceKey(seriesId: number, scheduledAt: Date) {
  return `${seriesId}:${scheduledAt.toISOString()}`;
}
