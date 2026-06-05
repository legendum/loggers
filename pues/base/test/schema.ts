/**
 * `createMemoryDb` — a fresh in-memory SQLite DB with the consumer's
 * `config/schema.sql` applied. For data-layer tests that mock `getDb` to a
 * `:memory:` handle (no `PUES_DB_PATH`, no real DB file) — the pattern alerting
 * and similar repos use:
 *
 *   import { createMemoryDb } from "pues/base/test/server";
 *
 *   let db = createMemoryDb();
 *   mock.module("../src/lib/db.js", () => ({ getDb: () => db }));
 *   // ...exercise the data layer against `db`...
 *
 * The `mock.module` wiring stays consumer-side (it names app-specific modules);
 * this just removes the repeated open + `PRAGMA foreign_keys` + read-and-exec of
 * the schema file. Default path is `config/schema.sql` relative to the cwd (the
 * repo root under `bun test`); pass an absolute/explicit path for other layouts.
 * For tests that drive the real `getDb()` against a temp file, use `createTempDb`.
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

export function createMemoryDb(schemaPath = "config/schema.sql"): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(schemaPath, "utf8"));
  return db;
}
