import { getLoggerByUlid } from "../../lib/loggersRegistry.js";
import { subscribeLoggerEvents } from "../../lib/loggerTailSse.js";

/** GET /logger/:ulid/events — batched SSE tail stream. */
export function getEvents(req: Request, ulid: string): Response {
  const logger = getLoggerByUlid(ulid);
  if (!logger) {
    return new Response(
      JSON.stringify({ error: "not_found", reason: "ulid" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return subscribeLoggerEvents(req, logger.ulid);
}
