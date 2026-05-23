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

-- Search is a case-insensitive LIKE substring scan over component/data/meta
-- (see src/lib/logsQuery.ts#searchLogs), bounded by the window/level/
-- component filters. No FTS index: token search didn't fit log filtering
-- (no substrings, no <3-char terms) and added write/sync cost.
