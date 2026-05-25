import { LOG_LEVELS, LOG_PAGE_SIZE, type LogLevel } from "./constants.js";
import { getLoggerDb, provisionLoggerDb } from "./loggerDb.js";
import type { LogWindow } from "./logWindow.js";
import { windowBoundsMs } from "./logWindow.js";

export type LogLineWire = {
  id: number;
  logged_at: number;
  level: LogLevel;
  component: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at: number;
};

type DbRow = {
  id: number;
  logged_at: number;
  level: string;
  component: string;
  data: string;
  meta: string;
  created_at: number;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function toWire(row: DbRow): LogLineWire {
  return {
    id: row.id,
    logged_at: row.logged_at,
    level: row.level as LogLevel,
    component: row.component,
    data: parseJsonObject(row.data),
    meta: parseJsonObject(row.meta),
    created_at: row.created_at,
  };
}

export type ListLogsParams = {
  ulid: string;
  window: LogWindow;
  tz?: string;
  level?: string | null;
  component?: string | null;
  limit?: number;
  cursor?: string | null;
  /**
   * "forward" (default) pages oldest→newest from `cursor` (legacy/SDK
   * behavior). "backward" pages newest→older — used by the terminal-tail
   * UI: the first call (no cursor) returns the most recent `limit` rows,
   * and each subsequent call walks older. Items are always returned
   * chronological (ascending) regardless of direction.
   */
  dir?: "forward" | "backward";
};

export type ListLogsResult = {
  items: LogLineWire[];
  next_cursor: string | null;
};

function parseCursor(
  raw: string | null,
): { logged_at: number; id: number } | null {
  if (!raw) return null;
  const [a, b] = raw.split(":");
  const logged_at = Number(a);
  const id = Number(b);
  if (!Number.isFinite(logged_at) || !Number.isInteger(id) || id <= 0)
    return null;
  return { logged_at, id };
}

function encodeCursor(logged_at: number, id: number): string {
  return `${logged_at}:${id}`;
}

export function listLogs(params: ListLogsParams): ListLogsResult {
  provisionLoggerDb(params.ulid);
  const db = getLoggerDb(params.ulid);
  const { fromMs, toMs } = windowBoundsMs(params.window, params.tz ?? "UTC");
  const limit = params.limit ?? LOG_PAGE_SIZE;
  const cursor = parseCursor(params.cursor ?? null);

  const backward = params.dir === "backward";

  const level =
    params.level && (LOG_LEVELS as readonly string[]).includes(params.level)
      ? params.level
      : null;
  const component = params.component?.trim() || null;

  let sql = `
    SELECT id, logged_at, level, component, data, meta, created_at
    FROM logger
    WHERE logged_at >= ? AND logged_at < ?
  `;
  const binds: Array<number | string> = [fromMs, toMs];

  if (level) {
    sql += " AND level = ?";
    binds.push(level);
  }
  if (component) {
    sql += " AND component = ?";
    binds.push(component);
  }
  if (cursor) {
    sql += backward
      ? " AND (logged_at < ? OR (logged_at = ? AND id < ?))"
      : " AND (logged_at > ? OR (logged_at = ? AND id > ?))";
    binds.push(cursor.logged_at, cursor.logged_at, cursor.id);
  }

  sql += backward
    ? " ORDER BY logged_at DESC, id DESC LIMIT ?"
    : " ORDER BY logged_at ASC, id ASC LIMIT ?";
  binds.push(limit + 1);

  const rows = db.query(sql).all(...binds) as DbRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // The boundary row for the *next* page in this direction is the last
  // row in query order: newest for forward, oldest for backward.
  const boundary = page[page.length - 1];
  const next_cursor =
    hasMore && boundary ? encodeCursor(boundary.logged_at, boundary.id) : null;

  // Always hand the client chronological (ascending) rows. Backward
  // queries come back descending, so flip them before mapping.
  const ordered = backward ? [...page].reverse() : page;
  const items = ordered.map(toWire);

  return { items, next_cursor };
}

/** Build a contains-pattern, escaping LIKE wildcards so user input that
 *  contains `%` or `_` is matched literally (paired with `ESCAPE '\'`). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * A parsed search term: either a `key:value` JSON-field match or a bare
 * `free` substring. Terms are AND-ed together (every term must match the row).
 */
export type Term = { key: string; value: string } | { free: string };

// One term per match: `key:value`, `key:"quoted value"`, `"quoted phrase"`,
// or a bare word. The key must be an identifier; the `(?!/)` stops
// `http://…` being read as a key named "http".
const TERM_RE = /(\w[\w.-]*):(?:"([^"]*)"|(?!\/)(\S+))|"([^"]*)"|(\S+)/g;

/** Split a query string into space-separated terms (see {@link Term}). */
export function parseTerms(q: string): Term[] {
  const out: Term[] = [];
  for (const m of q.matchAll(TERM_RE)) {
    if (m[1] !== undefined && (m[2] ?? m[3]) !== undefined)
      out.push({ key: m[1], value: (m[2] ?? m[3])! });
    else out.push({ free: (m[4] ?? m[5])! });
  }
  return out;
}

/**
 * Compile one term to a `LIKE` clause, pushing its bind values onto `binds`.
 *
 * A field term injects JSON punctuation and matches both string and scalar
 * values: `route:POST` → `'%"route":"POST%'` (string) OR `'%"route":POST%'`
 * (number/bool/null). The leading `"` and trailing `":` anchor the key, so
 * `user:x` does not match `"user_id":…`. The value is a prefix, not exact, so
 * `status:404` also matches `"status":4045`. Reusing `likePattern` escapes the
 * `_` in keys like `user_id` (otherwise `_` is a `LIKE` wildcard).
 */
function clauseFor(t: Term, binds: Array<number | string>): string {
  if ("free" in t) {
    const p = likePattern(t.free);
    binds.push(p, p, p);
    return "(component LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')";
  }
  const str = likePattern(`"${t.key}":"${t.value}`);
  const scalar = likePattern(`"${t.key}":${t.value}`);
  binds.push(str, scalar, str, scalar);
  return "(data LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')";
}

export type SearchLogsParams = {
  ulid: string;
  q: string;
  window?: LogWindow | null;
  tz?: string;
  level?: string | null;
  component?: string | null;
  limit?: number;
};

export function searchLogs(params: SearchLogsParams): LogLineWire[] {
  const q = params.q.trim();
  if (!q) return [];

  provisionLoggerDb(params.ulid);
  const db = getLoggerDb(params.ulid);
  const limit = params.limit ?? LOG_PAGE_SIZE;

  const level =
    params.level && (LOG_LEVELS as readonly string[]).includes(params.level)
      ? params.level
      : null;
  const component = params.component?.trim() || null;

  // Parse `q` into space-separated terms, AND-ed together. A bare word is a
  // case-insensitive substring (SQLite LIKE is ASCII case-insensitive) over
  // component/data/meta — data/meta being raw JSON, so it greps keys and
  // values alike. A `key:value` term injects JSON punctuation to match that
  // field. Always bounded by the period window below, so the scan stays small.
  const terms = parseTerms(q);
  if (!terms.length) return [];
  const binds: Array<number | string> = [];
  const clauses = terms.map((t) => clauseFor(t, binds));
  let sql = `
    SELECT id, logged_at, level, component, data, meta, created_at
    FROM logger
    WHERE (${clauses.join(" AND ")})
  `;

  if (params.window) {
    const { fromMs, toMs } = windowBoundsMs(params.window, params.tz ?? "UTC");
    sql += " AND logged_at >= ? AND logged_at < ?";
    binds.push(fromMs, toMs);
  }
  if (level) {
    sql += " AND level = ?";
    binds.push(level);
  }
  if (component) {
    sql += " AND component = ?";
    binds.push(component);
  }

  // Most recent `limit` matches, flipped to chronological so the newest
  // match sits at the bottom of the tail view.
  sql += " ORDER BY logged_at DESC, id DESC LIMIT ?";
  binds.push(limit);

  const rows = (db.query(sql).all(...binds) as DbRow[]).reverse();
  return rows.map(toWire);
}
