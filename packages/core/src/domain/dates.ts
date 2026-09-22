export const DEFAULT_TIMEZONE = "America/Chicago";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the value is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Today's calendar date (YYYY-MM-DD) in the owner's timezone (decision 011). */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function resolveTimeZone(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    throw new Error(`Invalid JWORD_TIMEZONE "${candidate}"`);
  }
}

export interface Clock {
  /** Today's date in the owner's timezone, as YYYY-MM-DD. */
  today(): string;
  now(): Date;
}

export function createClock(timeZone: string): Clock {
  const tz = resolveTimeZone(timeZone);
  return {
    today: () => todayInTimeZone(tz),
    now: () => new Date(),
  };
}

export function fixedClock(today: string, now: Date = new Date(`${today}T12:00:00Z`)): Clock {
  return { today: () => today, now: () => now };
}
