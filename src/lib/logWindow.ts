export type LogWindow = "today" | "yesterday" | "last_7_days";

const WINDOWS = new Set<LogWindow>(["today", "yesterday", "last_7_days"]);

export function parseLogWindow(raw: string | null): LogWindow | null {
  if (!raw) return "today";
  return WINDOWS.has(raw as LogWindow) ? (raw as LogWindow) : null;
}

/** Calendar-day bounds for a preset window in an IANA timezone (default UTC). */
export function windowBoundsMs(
  window: LogWindow,
  tz = "UTC",
): { fromMs: number; toMs: number } {
  const now = new Date();
  const today = calendarDateInTz(now, tz);
  let startDate = today;
  if (window === "yesterday") {
    startDate = addDays(today, -1);
  } else if (window === "last_7_days") {
    startDate = addDays(today, -6);
  }
  const endDate = window === "yesterday" ? today : addDays(today, 1);
  return {
    fromMs: midnightMs(startDate, tz),
    toMs: midnightMs(endDate, tz),
  };
}

type Ymd = { y: number; m: number; d: number };

function calendarDateInTz(d: Date, tz: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, d: day };
}

function addDays(ymd: Ymd, delta: number): Ymd {
  const utc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + delta));
  return {
    y: utc.getUTCFullYear(),
    m: utc.getUTCMonth() + 1,
    d: utc.getUTCDate(),
  };
}

/** Start of Y-M-D 00:00:00 in `tz`, as unix ms. */
function midnightMs(ymd: Ymd, tz: string): number {
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0);
  const offset = tzOffsetMs(new Date(guess), tz);
  return guess - offset;
}

function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Date.UTC(y, m - 1, day, hour, 0, 0, 0) - d.getTime();
}
