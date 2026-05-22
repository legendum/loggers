-- Loggers SQLite schema (v1)
-- Canonical reference for control DB + per-logger DB setup.
-- Source of truth: docs/SPEC.md
--
-- IMPORTANT:
-- - Enable FK enforcement on every connection:
--     PRAGMA foreign_keys = ON;
-- - Enable WAL mode for concurrency:
--     PRAGMA journal_mode = WAL;
--
-- ---------------------------------------------------------------------------
-- Control DB: data/loggers.db
-- ---------------------------------------------------------------------------

-- Users table follows Pues auth + billing conventions.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  legendum_token TEXT,
  meta           TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Logger registry (one row per user-owned logger stream).
CREATE TABLE IF NOT EXISTS loggers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ulid       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_loggers_user_id ON loggers(user_id);
CREATE INDEX IF NOT EXISTS idx_loggers_position ON loggers(user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loggers_user_slug ON loggers(user_id, slug);

-- Internal Loggers failure sink (dogfood path).
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

-- ---------------------------------------------------------------------------
-- Per-logger DB: data/loggers/<ulid>.db
-- ---------------------------------------------------------------------------
--
-- Apply this section to each per-logger SQLite file.
-- The table shape intentionally matches control-db logger for shared code paths.

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

CREATE INDEX IF NOT EXISTS idx_logger_logged_at ON logger(logged_at);
CREATE INDEX IF NOT EXISTS idx_logger_level_logged_at ON logger(level, logged_at);
CREATE INDEX IF NOT EXISTS idx_logger_component_logged_at ON logger(component, logged_at);

-- FTS5 search index for component/data/meta text projections.
CREATE VIRTUAL TABLE IF NOT EXISTS logger_fts USING fts5(
  component,
  data_text,
  meta_text,
  content=logger,
  content_rowid=id,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS logger_ai AFTER INSERT ON logger BEGIN
  INSERT INTO logger_fts(rowid, component, data_text, meta_text)
  VALUES (new.id, new.component, new.data, new.meta);
END;

CREATE TRIGGER IF NOT EXISTS logger_ad AFTER DELETE ON logger BEGIN
  INSERT INTO logger_fts(logger_fts, rowid, component, data_text, meta_text)
  VALUES ('delete', old.id, old.component, old.data, old.meta);
END;

CREATE TRIGGER IF NOT EXISTS logger_au AFTER UPDATE ON logger BEGIN
  INSERT INTO logger_fts(logger_fts, rowid, component, data_text, meta_text)
  VALUES ('delete', old.id, old.component, old.data, old.meta);
  INSERT INTO logger_fts(rowid, component, data_text, meta_text)
  VALUES (new.id, new.component, new.data, new.meta);
END;
