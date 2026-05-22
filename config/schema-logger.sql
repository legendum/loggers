-- Per-logger DB: data/loggers/<ulid>.db
-- Applied by src/lib/loggerDb.ts on provision/open.
-- Canonical reference: docs/SPEC.md §3.2–3.3

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
