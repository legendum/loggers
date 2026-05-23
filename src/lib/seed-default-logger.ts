import { ulid } from "pues/base/core";
import { getDb } from "pues/base/db/server";
import { provisionLoggerDb } from "./loggerDb.js";
import { toSlug, validateLoggerName } from "./loggers.js";

const DEFAULT_LOGGER_NAME = "My first logger";

/**
 * Insert a starter logger for a newly created user (self-hosted bootstrap
 * or first Legendum link). No billing — same pattern as fifos' seed fifo.
 */
export function seedDefaultLoggerForNewUser(userId: number): void {
  const name = DEFAULT_LOGGER_NAME;
  const nameErr = validateLoggerName(name);
  if (nameErr) {
    console.error("seedDefaultLoggerForNewUser: invalid default name", nameErr);
    return;
  }

  const slug = toSlug(name);
  const db = getDb();
  const dup = db
    .query("SELECT 1 FROM loggers WHERE user_id = ? AND slug = ?")
    .get(userId, slug);
  if (dup) return;

  const maxPosRow = db
    .query(
      "SELECT COALESCE(MAX(position), -1) AS max_pos FROM loggers WHERE user_id = ?",
    )
    .get(userId) as { max_pos: number };
  const position = maxPosRow.max_pos + 1;
  const loggerUlid = ulid();

  db.run(
    "INSERT INTO loggers (user_id, ulid, name, slug, position) VALUES (?, ?, ?, ?, ?)",
    [userId, loggerUlid, name, slug, position],
  );

  provisionLoggerDb(loggerUlid);
}
