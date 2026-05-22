-- Loggers control DB: data/loggers.db
-- Per-logger event DB DDL lives in config/schema-logger.sql.
-- Source of truth: docs/SPEC.md
--
-- IMPORTANT (applied by pues getDb on every connection):
--   PRAGMA foreign_keys = ON;
--   PRAGMA journal_mode = WAL;

-- Users table follows Pues auth + billing conventions.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  legendum_token TEXT,
  meta           TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Logger registry (one row per user-owned logger stream).
-- `meta` is pues' optional role column for per-row app metadata; pues
-- auto-projects it on wire reads and merges it on PATCH.
CREATE TABLE IF NOT EXISTS loggers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ulid       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_loggers_user_id ON loggers(user_id);
CREATE INDEX IF NOT EXISTS idx_loggers_position ON loggers(user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loggers_user_slug ON loggers(user_id, slug);

-- Internal Loggers failure sink (dogfood path; no FTS on control DB).
CREATE TABLE IF NOT EXISTS logger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at  INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  level      TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  component  TEXT NOT NULL,
  data       TEXT NOT NULL,
  meta       TEXT NOT NULL
);
