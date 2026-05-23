import { isAbsolute, resolve } from "node:path";
import { defaultRoot } from "pues/base/core/defaultRoot";

export const PORT = Number(process.env.PORT ?? "3000");

/** Crockford base32 ULID matcher — shared with pues and sister repos. */
export { ULID_RE } from "pues/base/core";

/** Read an integer env var, falling back when unset/blank/non-finite or
 *  below `min` (default 1; pass 0 to allow zero). */
function envInt(key: string, fallback: number, min = 1): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

export function loggersDbDir(): string {
  const raw = process.env.LOGGERS_DB_DIR ?? "data/loggers";
  return isAbsolute(raw) ? raw : resolve(defaultRoot(), raw);
}

export function loggersMaxOpenDbs(): number {
  return envInt("LOGGERS_MAX_OPEN_DBS", 32);
}

export function loggersDbIdleMs(): number {
  return envInt("LOGGERS_DB_IDLE_MS", 60_000, 0);
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function loggersMaxBatch(): number {
  return envInt("LOGGERS_MAX_BATCH", 500);
}

export function loggersMaxLineBytes(): number {
  return envInt("LOGGERS_MAX_LINE_BYTES", 65536);
}

/** Per-user logger cap (`LOGGERS_MAX_LOGGERS_PER_USER`, default 50). */
export function maxLoggersPerUser(): number {
  return envInt("LOGGERS_MAX_LOGGERS_PER_USER", 50);
}

/** Max log lines per `logs_batch` SSE frame (`SSE_BATCH_MAX_EVENTS`, default 200). */
export function sseBatchMaxEvents(): number {
  return envInt("SSE_BATCH_MAX_EVENTS", 200);
}

/** Batch flush interval in ms (`SSE_BATCH_MAX_MS`, default 250). */
export function sseBatchMaxMs(): number {
  return envInt("SSE_BATCH_MAX_MS", 250);
}

/** Ring buffer size in batches per logger (`SSE_REPLAY_BUFFER_BATCHES`, default 200). */
export function sseReplayBufferBatches(): number {
  return envInt("SSE_REPLAY_BUFFER_BATCHES", 200, 0);
}

/** SSE keep-alive comment interval (`SSE_HEARTBEAT_MS`, default 25s). */
export function sseHeartbeatMs(): number {
  return envInt("SSE_HEARTBEAT_MS", 25_000);
}
