import { getDb } from "pues/base/db/server";
import type { LevelCounts } from "./levelCountsTypes.js";
import { getLevelCounts } from "./loggerCounts.js";
import { windowBoundsMs } from "./logWindow.js";

/** Flat rows for client-side merge (fifos `useCounts` shape). */
export type LoggerLevelCountRow = {
  parent_id: string;
  value: keyof LevelCounts;
  n: number;
};

/** Per-logger level counts for a user's loggers, scoped to "today" in `tz`
 *  — the default window the UI opens on, so the chips match the rows. */
export function listLevelCountRows(
  userId: number,
  tz = "UTC",
): LoggerLevelCountRow[] {
  const db = getDb();
  const loggers = db
    .query("SELECT ulid FROM loggers WHERE user_id = ? ORDER BY position ASC")
    .all(userId) as { ulid: string }[];

  const bounds = windowBoundsMs("today", tz);
  const out: LoggerLevelCountRow[] = [];
  for (const { ulid } of loggers) {
    const counts = getLevelCounts(ulid, bounds);
    for (const level of ["debug", "info", "warn", "error"] as const) {
      if (counts[level] > 0) {
        out.push({ parent_id: ulid, value: level, n: counts[level] });
      }
    }
  }
  return out;
}
