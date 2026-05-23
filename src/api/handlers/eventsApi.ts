import { getLoggerByUlid } from "../../lib/loggersRegistry.js";
import { subscribeLoggerEvents } from "../../lib/loggerTailSse.js";
import { notFoundUlid } from "./responses.js";

/** GET /logger/:ulid/events — batched SSE tail stream. */
export function getEvents(req: Request, ulid: string): Response {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();
  return subscribeLoggerEvents(req, logger.ulid);
}
