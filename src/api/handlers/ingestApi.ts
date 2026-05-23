import { chargeIngestWrite } from "../../lib/billing.js";
import { loggersMaxBatch } from "../../lib/constants.js";
import {
  toWireRow,
  validateIngestLine,
  writeIngestLines,
} from "../../lib/ingest.js";
import { getLoggerByUlid } from "../../lib/loggersRegistry.js";
import { json } from "../json.js";
import { invalidRequest, notFoundUlid } from "./responses.js";

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** POST /logger/:ulid/ingest — single log line. */
export async function postIngest(
  req: Request,
  ulid: string,
): Promise<Response> {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();

  const body = await parseBody(req);
  const validated = validateIngestLine(body);
  if (!validated.ok) return invalidRequest(validated.message);

  const chargeError = await chargeIngestWrite(logger.user_id, 1);
  if (chargeError) return chargeError;

  const [row] = writeIngestLines(logger, [validated.line]);
  return json(toWireRow(row), 201);
}

/** POST /logger/:ulid/batch — many log lines. */
export async function postBatch(req: Request, ulid: string): Promise<Response> {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();

  const body = await parseBody(req);
  let rawLines: unknown[] | null = null;
  if (Array.isArray(body)) {
    rawLines = body;
  } else if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as { lines?: unknown }).lines)
  ) {
    rawLines = (body as { lines: unknown[] }).lines;
  }
  if (!rawLines) {
    return invalidRequest("body must be an array or { lines: [...] }");
  }

  const max = loggersMaxBatch();
  if (rawLines.length === 0) {
    return invalidRequest("batch must include at least one line");
  }
  if (rawLines.length > max) {
    return invalidRequest(`batch exceeds maximum of ${max} lines`);
  }

  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const validated = validateIngestLine(rawLines[i]);
    if (!validated.ok) {
      return invalidRequest(`lines[${i}]: ${validated.message}`);
    }
    lines.push(validated.line);
  }

  const chargeError = await chargeIngestWrite(logger.user_id, lines.length);
  if (chargeError) return chargeError;

  const inserted = writeIngestLines(logger, lines);
  return json(
    {
      accepted: inserted.length,
      items: inserted.map(toWireRow),
    },
    201,
  );
}
