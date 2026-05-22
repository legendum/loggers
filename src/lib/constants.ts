import { isAbsolute, resolve } from "node:path";
import { defaultRoot } from "pues/base/core/defaultRoot";

export const PORT = Number(process.env.PORT ?? "3000");
export const HOST = String(process.env.HOST ?? "0.0.0.0");

/** Crockford base32 ULID (26 chars). */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function loggersDbDir(): string {
  const raw = process.env.LOGGERS_DB_DIR ?? "data/loggers";
  return isAbsolute(raw) ? raw : resolve(defaultRoot(), raw);
}

export function loggersMaxOpenDbs(): number {
  const n = Number(process.env.LOGGERS_MAX_OPEN_DBS ?? "32");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 32;
}

export function loggersDbIdleMs(): number {
  const n = Number(process.env.LOGGERS_DB_IDLE_MS ?? "60000");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60_000;
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function loggersMaxBatch(): number {
  const n = Number(process.env.LOGGERS_MAX_BATCH ?? "500");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function loggersMaxLineBytes(): number {
  const n = Number(process.env.LOGGERS_MAX_LINE_BYTES ?? "65536");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 65536;
}

/** Per-user logger cap (`LOGGERS_MAX_LOGGERS_PER_USER`, default 50). */
export function maxLoggersPerUser(): number {
  const raw = process.env.LOGGERS_MAX_LOGGERS_PER_USER;
  if (raw === undefined || raw === "") return 50;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

/** Max log lines per `logs_batch` SSE frame (`SSE_BATCH_MAX_EVENTS`, default 200). */
export function sseBatchMaxEvents(): number {
  const n = Number(process.env.SSE_BATCH_MAX_EVENTS ?? "200");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

/** Batch flush interval in ms (`SSE_BATCH_MAX_MS`, default 250). */
export function sseBatchMaxMs(): number {
  const n = Number(process.env.SSE_BATCH_MAX_MS ?? "250");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 250;
}

/** Ring buffer size in batches per logger (`SSE_REPLAY_BUFFER_BATCHES`, default 200). */
export function sseReplayBufferBatches(): number {
  const n = Number(process.env.SSE_REPLAY_BUFFER_BATCHES ?? "200");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
}

/** SSE keep-alive comment interval (`SSE_HEARTBEAT_MS`, default 25s). */
export function sseHeartbeatMs(): number {
  const n = Number(process.env.SSE_HEARTBEAT_MS ?? "25000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25_000;
}
