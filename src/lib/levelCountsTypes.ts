/** Shared level-count shape (safe for browser bundles — no SQLite). */
export type LevelCounts = {
  debug: number;
  info: number;
  warn: number;
  error: number;
};

export const EMPTY_LEVEL_COUNTS: LevelCounts = {
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
};
