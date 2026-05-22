import { EMPTY_LEVEL_COUNTS, type LevelCounts } from "./levelCountsTypes.js";
import { getLoggerDb } from "./loggerDb.js";

export type { LevelCounts } from "./levelCountsTypes.js";
export { EMPTY_LEVEL_COUNTS } from "./levelCountsTypes.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;

/** All-time level counts from the per-logger DB (zeros if the file is missing). */
export function getLevelCounts(ulid: string): LevelCounts {
  const counts = { ...EMPTY_LEVEL_COUNTS };
  try {
    const db = getLoggerDb(ulid);
    const rows = db
      .query("SELECT level, COUNT(*) AS n FROM logger GROUP BY level")
      .all() as { level: string; n: number }[];
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
