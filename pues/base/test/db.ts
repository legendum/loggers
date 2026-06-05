/**
 * `createTempDb` — a throwaway on-disk SQLite DB for tests that exercise the real
 * `getDb()` (schema + migrations + self-hosted mode) but don't need an HTTP
 * server. The DB-only counterpart to `bootTestService`: it points `PUES_DB_PATH`
 * at a temp file, unsets the Legendum creds, cleans any stale file, and hands back
 * the consumer's `getDb` (re-exported so you don't need a second import) plus a
 * `stop()` that resets the shared handle and deletes the file.
 *
 *   import { createTempDb } from "pues/base/test/server";
 *
 *   const t = createTempDb();
 *   const db = t.getDb();           // applies config/schema.sql on first call
 *   // ...queries / data-layer calls...
 *   t.stop();
 *
 * For tests that mock `getDb` to an in-memory handle instead, use `createMemoryDb`.
 * Consumer-specific cache resets (e.g. per-ULID DB caches) stay in the consumer's
 * teardown.
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { getDb, resetDbForTesting } from "../db/server";

export type TempDbOptions = {
  /** Temp DB path (else a random `data/test-db-*.db`). Deleted on `stop()`. */
  dbPath?: string;
  /** Extra env vars set before any `getDb()` call (consumer caps/flags). */
  env?: Record<string, string>;
};

export type TempDb = {
  dbPath: string;
  /** The shared `getDb()` — applies schema/migrations on first call. */
  getDb: typeof getDb;
  /** Reset the shared DB handle and delete the temp file. */
  stop: () => void;
};

export function createTempDb(opts: TempDbOptions = {}): TempDb {
  const dbPath =
    opts.dbPath ?? `data/test-db-${Math.floor(Math.random() * 1e6)}.db`;

  process.env.PUES_DB_PATH = dbPath;
  delete process.env.LEGENDUM_API_KEY;
  delete process.env.LEGENDUM_SECRET;
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) process.env[k] = v;
  }

  mkdirSync("data", { recursive: true });
  if (existsSync(dbPath)) unlinkSync(dbPath);

  return {
    dbPath,
    getDb,
    stop() {
      resetDbForTesting();
      if (existsSync(dbPath)) unlinkSync(dbPath);
    },
  };
}
