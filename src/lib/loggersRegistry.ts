import { getDb } from "pues/base/db/server";
import { assertValidLoggerUlid } from "./loggerDb.js";

export type LoggerRecord = {
  id: number;
  user_id: number;
  ulid: string;
  name: string;
  slug: string;
};

export function getLoggerByUlid(ulid: string): LoggerRecord | null {
  assertValidLoggerUlid(ulid);
  return (
    (getDb()
      .query("SELECT id, user_id, ulid, name, slug FROM loggers WHERE ulid = ?")
      .get(ulid) as LoggerRecord | undefined) ?? null
  );
}
