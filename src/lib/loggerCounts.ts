import { EMPTY_LEVEL_COUNTS, type LevelCounts } from "./levelCountsTypes.js";
import { getLoggerDb } from "./loggerDb.js";

export type { LevelCounts } from "./levelCountsTypes.js";
export { EMPTY_LEVEL_COUNTS } from "./levelCountsTypes.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;

/** Level counts from the per-logger DB. Pass `bounds` (unix ms) to scope to
 *  a time window; omit for all-time. Zeros if the file is missing. */
export function getLevelCounts(
  ulid: string,
  bounds?: { fromMs: number; toMs: number },
): LevelCounts {
  const counts = { ...EMPTY_LEVEL_COUNTS };
  try {
    const db = getLoggerDb(ulid);
    const rows = (
      bounds
        ? db
            .query(
              "SELECT level, COUNT(*) AS n FROM logger WHERE logged_at >= ? AND logged_at < ? GROUP BY level",
            )
            .all(bounds.fromMs, bounds.toMs)
        : db
            .query("SELECT level, COUNT(*) AS n FROM logger GROUP BY level")
            .all()
    ) as { level: string; n: number }[];
    for (const row of rows) {
      if ((LEVELS as readonly string[]).includes(row.level)) {
        counts[row.level as keyof LevelCounts] = row.n;
      }
    }
  } catch {
    // missing or unreadable per-logger file
  }
  return counts;
}
