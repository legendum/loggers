export type { LevelCounts } from "../lib/levelCountsTypes.js";
export { EMPTY_LEVEL_COUNTS } from "../lib/levelCountsTypes.js";

/** Home-list row from `useResource("loggers")` — counts merged client-side. */
export type LoggerEntry = {
  id: string;
  label: string;
  slug: string;
  position: number;
  created_at?: number;
  updated_at?: number;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogLine = {
  id: number;
  logged_at: number;
  level: LogLevel;
  component: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at?: number;
};

export type LogWindow = "today" | "yesterday" | "last_7_days";
