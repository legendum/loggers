/**
 * Server-side log retention for the per-logger SQLite tables.
 *
 * Nothing else deletes log rows, so the tables would grow without bound.
 * We keep a FIXED rolling window of 7×24h — matching the widest UI window
 * (last_7_days) — and sweep infrequently (see the scheduler in server.ts).
 *
 * This is unrelated to the SDK's local *file* retention, which is the
 * user's choice on their own disk (`fileRetentionDays` / loggers.yaml).
 */

import { readdirSync } from "node:fs";
import { loggersDbDir, ULID_RE } from "./constants.js";
import { getLoggerDb } from "./loggerDb.js";

/** Fixed retention window: 7 × 24 hours (rolling, not calendar days). */
export const DB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** ULIDs of per-logger DB files that already exist on disk. Enumerating
 *  files (not the loggers registry) avoids creating a `.db` for a logger
 *  that has never been written to. */
function existingLoggerUlids(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(loggersDbDir());
  } catch {
    return []; // dir not created yet
  }
  return entries
    .filter((name) => name.endsWith(".db"))
    .map((name) => name.slice(0, -3))
    .filter((ulid) => ULID_RE.test(ulid));
}

/**
 * Delete log rows older than the retention window from every per-logger DB
 * on disk. `now` is injectable for tests. Returns a summary for logging.
 */
export function purgeExpiredLogs(now: number = Date.now()): {
  loggers: number;
  deleted: number;
} {
  const cutoff = now - DB_RETENTION_MS;
  let loggers = 0;
  let deleted = 0;
  for (const ulid of existingLoggerUlids()) {
    try {
      const db = getLoggerDb(ulid);
      const res = db.run("DELETE FROM logger WHERE logged_at < ?", [cutoff]);
      deleted += Number(res.changes ?? 0);
      loggers += 1;
    } catch {
      // Skip an unreadable / mid-write DB; the next sweep retries it.
    }
  }
  return { loggers, deleted };
}
