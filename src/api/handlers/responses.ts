import { json } from "../json.js";

/** 404 for an unknown logger ULID — the public API's "no such logger". */
export function notFoundUlid(): Response {
  return json({ error: "not_found", reason: "ulid" }, 404);
}

/** 400 with a human-readable validation message. */
export function invalidRequest(message: string): Response {
  return json({ error: "invalid_request", message }, 400);
}
