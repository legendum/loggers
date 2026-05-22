import {
  EMPTY_LEVEL_COUNTS,
  type LevelCounts,
} from "../lib/levelCountsTypes.js";

export type LoggerLevelCountRow = {
  parent_id: string;
  value: keyof LevelCounts;
  n: number;
};

export function indexLevelCountsByLogger(
  rows: LoggerLevelCountRow[],
): Record<string, LevelCounts> {
  const out: Record<string, LevelCounts> = {};
  for (const row of rows) {
    const key = String(row.parent_id);
    if (!out[key]) out[key] = { ...EMPTY_LEVEL_COUNTS };
    out[key][row.value] = row.n;
  }
  return out;
}
