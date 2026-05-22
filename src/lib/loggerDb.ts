/**
 * Per-logger SQLite files under LOGGERS_DB_DIR/<ulid>.db.
 * LRU + idle eviction for open handles (SPEC §4.1).
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { defaultRoot } from "pues/base/core/defaultRoot";
import {
  loggersDbDir,
  loggersDbIdleMs,
  loggersMaxOpenDbs,
  ULID_RE,
} from "./constants.js";

type CacheEntry = { db: Database; lastUsed: number };

const cache = new Map<string, CacheEntry>();
let loggerSchemaSql: string | null = null;

function maxOpenDbs(): number {
  return loggersMaxOpenDbs();
}

function idleMs(): number {
  return loggersDbIdleMs();
}

function loadLoggerSchema(root: string): string {
  if (loggerSchemaSql) return loggerSchemaSql;
  const path = join(root, "config/schema-logger.sql");
  loggerSchemaSql = readFileSync(path, "utf8");
  return loggerSchemaSql;
}

export function assertValidLoggerUlid(ulid: string): void {
  if (!ULID_RE.test(ulid)) {
    throw new Error(`invalid logger ulid: ${ulid}`);
  }
}

export function loggerDbPath(ulid: string): string {
  assertValidLoggerUlid(ulid);
  return join(loggersDbDir(), `${ulid}.db`);
}

function touchCache(ulid: string, entry: CacheEntry): void {
  cache.delete(ulid);
  entry.lastUsed = Date.now();
  cache.set(ulid, entry);
}

function closeEntry(ulid: string): void {
  const entry = cache.get(ulid);
  if (!entry) return;
  entry.db.close();
  cache.delete(ulid);
}

function evictIdle(): void {
  const cutoff = Date.now() - idleMs();
  for (const [ulid, entry] of cache) {
    if (entry.lastUsed < cutoff) closeEntry(ulid);
  }
}

function evictOverflow(): void {
  const max = maxOpenDbs();
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    closeEntry(oldest);
  }
}

function openLoggerDatabase(ulid: string): Database {
  const root = defaultRoot();
  mkdirSync(loggersDbDir(), { recursive: true });
  const path = loggerDbPath(ulid);
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(loadLoggerSchema(root));
  return db;
}

/** Ensure per-logger DB file exists with schema applied. */
export function provisionLoggerDb(ulid: string): void {
  assertValidLoggerUlid(ulid);
  const existing = cache.get(ulid);
  if (existing) {
    touchCache(ulid, existing);
    return;
  }
  const db = openLoggerDatabase(ulid);
  touchCache(ulid, { db, lastUsed: Date.now() });
  evictOverflow();
}

/** Cached handle for a per-logger DB (opens and provisions on first use). */
export function getLoggerDb(ulid: string): Database {
  assertValidLoggerUlid(ulid);
  evictIdle();
  const hit = cache.get(ulid);
  if (hit) {
    touchCache(ulid, hit);
    return hit.db;
  }
  const db = openLoggerDatabase(ulid);
  touchCache(ulid, { db, lastUsed: Date.now() });
  evictOverflow();
  return db;
}

/** Close handle and remove per-logger DB file from disk. */
export function deleteLoggerDb(ulid: string): void {
  assertValidLoggerUlid(ulid);
  closeEntry(ulid);
  const path = loggerDbPath(ulid);
  if (existsSync(path)) unlinkSync(path);
}

export function closeAllLoggerDbs(): void {
  for (const ulid of [...cache.keys()]) closeEntry(ulid);
}

/** Test-only: drop cached handles without deleting files. */
export function resetLoggerDbCacheForTesting(): void {
  closeAllLoggerDbs();
  loggerSchemaSql = null;
}

/** Test-only: number of open per-logger DB handles. */
export function openLoggerDbCountForTesting(): number {
  return cache.size;
}
