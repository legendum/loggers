import type { Database } from "bun:sqlite";
import { LOG_LEVELS, type LogLevel, loggersMaxLineBytes } from "./constants.js";
import { getLoggerDb, provisionLoggerDb } from "./loggerDb.js";
import type { LoggerRecord } from "./loggersRegistry.js";
import { publishIngestedRows } from "./loggerTailSse.js";
import { buildMeta } from "./postProcess.js";

export type IngestLineInput = {
  level: LogLevel;
  component: string;
  data: Record<string, unknown>;
  logged_at: number;
};

export type InsertedLogRow = {
  id: number;
  logged_at: number;
  level: LogLevel;
  component: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at: number;
};

/** Public wire shape for an ingested row: the stored row minus `created_at`
 *  (the server-receipt timestamp, not part of the public line). */
export type WireLogRow = Omit<InsertedLogRow, "created_at">;

/** Project a stored row onto the public wire shape. Shared by the ingest
 *  response and the SSE tail so they can't drift. */
export function toWireRow(row: InsertedLogRow): WireLogRow {
  return {
    id: row.id,
    logged_at: row.logged_at,
    level: row.level,
    component: row.component,
    data: row.data,
    meta: row.meta,
  };
}

const MAX_COMPONENT_LEN = 128;

export function validateIngestLine(
  raw: unknown,
): { ok: true; line: IngestLineInput } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "line must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  const level = body.level;
  if (
    typeof level !== "string" ||
    !(LOG_LEVELS as readonly string[]).includes(level)
  ) {
    return {
      ok: false,
      message: "level must be one of debug, info, warn, error",
    };
  }

  const component =
    typeof body.component === "string" ? body.component.trim() : "";
  if (!component) {
    return { ok: false, message: "component is required" };
  }
  if (component.length > MAX_COMPONENT_LEN) {
    return { ok: false, message: "component is too long" };
  }

  const loggedAt = body.logged_at;
  if (
    typeof loggedAt !== "number" ||
    !Number.isFinite(loggedAt) ||
    !Number.isInteger(loggedAt) ||
    loggedAt <= 0
  ) {
    return {
      ok: false,
      message: "logged_at must be a positive integer (unix ms)",
    };
  }

  let data = body.data;
  if (data === undefined) data = {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, message: "data must be a JSON object" };
  }

  const dataJson = JSON.stringify(data);
  if (dataJson.length > loggersMaxLineBytes()) {
    return {
      ok: false,
      message: `data exceeds ${loggersMaxLineBytes()} bytes`,
    };
  }

  return {
    ok: true,
    line: {
      level: level as LogLevel,
      component,
      data: data as Record<string, unknown>,
      logged_at: loggedAt,
    },
  };
}

function insertLine(
  db: Database,
  line: IngestLineInput,
  receiptSec: number,
): InsertedLogRow {
  const dataJson = JSON.stringify(line.data);
  const meta = buildMeta(line.data, line.component);
  const metaJson = JSON.stringify(meta);

  const result = db.run(
    `INSERT INTO logger (logged_at, level, component, data, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      line.logged_at,
      line.level,
      line.component,
      dataJson,
      metaJson,
      receiptSec,
      receiptSec,
    ],
  );

  return {
    id: Number(result.lastInsertRowid),
    logged_at: line.logged_at,
    level: line.level,
    component: line.component,
    data: line.data,
    meta,
    created_at: receiptSec,
  };
}

export function writeIngestLines(
  logger: LoggerRecord,
  lines: IngestLineInput[],
): InsertedLogRow[] {
  provisionLoggerDb(logger.ulid);
  const db = getLoggerDb(logger.ulid);
  const receiptSec = Math.floor(Date.now() / 1000);

  const out = db.transaction(() => {
    const rows: InsertedLogRow[] = [];
    for (const line of lines) {
      rows.push(insertLine(db, line, receiptSec));
    }
    return rows;
  })();

  publishIngestedRows(logger.ulid, out);
  return out;
}
