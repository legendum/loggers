import { LOG_LEVELS, type LogLevel } from "./constants.js";
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
};

export type ListLogsResult = {
  items: LogLineWire[];
  next_cursor: string | null;
};

export function parseCursor(
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

export function encodeCursor(logged_at: number, id: number): string {
  return `${logged_at}:${id}`;
}

export function listLogs(params: ListLogsParams): ListLogsResult {
  provisionLoggerDb(params.ulid);
  const db = getLoggerDb(params.ulid);
  const { fromMs, toMs } = windowBoundsMs(params.window, params.tz ?? "UTC");
  const limit = params.limit ?? 100;
  const cursor = parseCursor(params.cursor ?? null);

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
    sql += " AND (logged_at > ? OR (logged_at = ? AND id > ?))";
    binds.push(cursor.logged_at, cursor.logged_at, cursor.id);
  }

  sql += " ORDER BY logged_at ASC, id ASC LIMIT ?";
  binds.push(limit + 1);

  const rows = db.query(sql).all(...binds) as DbRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(toWire);

  const last = page[page.length - 1];
  const next_cursor =
    hasMore && last ? encodeCursor(last.logged_at, last.id) : null;

  return { items, next_cursor };
}

/** Escape user text for FTS5 MATCH (phrase per token). */
export function escapeFtsQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
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
  const fts = escapeFtsQuery(params.q);
  if (!fts) return [];

  provisionLoggerDb(params.ulid);
  const db = getLoggerDb(params.ulid);
  const limit = params.limit ?? 100;

  const level =
    params.level && (LOG_LEVELS as readonly string[]).includes(params.level)
      ? params.level
      : null;
  const component = params.component?.trim() || null;

  let sql = `
    SELECT l.id, l.logged_at, l.level, l.component, l.data, l.meta, l.created_at
    FROM logger l
    JOIN logger_fts fts ON fts.rowid = l.id
    WHERE logger_fts MATCH ?
  `;
  const binds: Array<number | string> = [fts];

  if (params.window) {
    const { fromMs, toMs } = windowBoundsMs(params.window, params.tz ?? "UTC");
    sql += " AND l.logged_at >= ? AND l.logged_at < ?";
    binds.push(fromMs, toMs);
  }
  if (level) {
    sql += " AND l.level = ?";
    binds.push(level);
  }
  if (component) {
    sql += " AND l.component = ?";
    binds.push(component);
  }

  sql += " ORDER BY l.logged_at ASC, l.id ASC LIMIT ?";
  binds.push(limit);

  const rows = db.query(sql).all(...binds) as DbRow[];
  return rows.map(toWire);
}
