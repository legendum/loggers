import { getDb } from "pues/base/db/server";
import type { LevelCounts } from "./levelCountsTypes.js";
import { getLevelCounts } from "./loggerCounts.js";

/** Flat rows for client-side merge (fifos `useCounts` shape). */
export type LoggerLevelCountRow = {
  parent_id: string;
  value: keyof LevelCounts;
  n: number;
};

export function listLevelCountRows(userId: number): LoggerLevelCountRow[] {
  const db = getDb();
  const loggers = db
    .query("SELECT ulid FROM loggers WHERE user_id = ? ORDER BY position ASC")
    .all(userId) as { ulid: string }[];

  const out: LoggerLevelCountRow[] = [];
  for (const { ulid } of loggers) {
    const counts = getLevelCounts(ulid);
    for (const level of ["debug", "info", "warn", "error"] as const) {
      if (counts[level] > 0) {
        out.push({ parent_id: ulid, value: level, n: counts[level] });
      }
    }
  }
  return out;
}
