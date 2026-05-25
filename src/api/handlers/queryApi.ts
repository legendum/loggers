import { getLevelCounts } from "../../lib/loggerCounts.js";
import { getLoggerByUlid } from "../../lib/loggersRegistry.js";
import { listLogs, searchLogs } from "../../lib/logsQuery.js";
import { parseLogWindow, windowBoundsMs } from "../../lib/logWindow.js";
import { json } from "../json.js";
import { invalidRequest, notFoundUlid } from "./responses.js";

function clampLimitParam(raw: string | null): number {
  const n = raw == null ? 100 : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(n, 100);
}

/** GET /logger/:ulid/logs */
export function getLogs(req: Request, ulid: string): Response {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();

  const url = new URL(req.url);
  const window = parseLogWindow(url.searchParams.get("window"));
  if (!window) {
    return invalidRequest("window must be today, yesterday, or last_7_days");
  }

  const cursor = url.searchParams.get("cursor");
  if (cursor && !cursor.includes(":")) {
    return invalidRequest("cursor must be logged_at:id");
  }

  const dir =
    url.searchParams.get("dir") === "backward" ? "backward" : "forward";

  const result = listLogs({
    ulid,
    window,
    tz: url.searchParams.get("tz") ?? "UTC",
    level: url.searchParams.get("level"),
    component: url.searchParams.get("component"),
    limit: clampLimitParam(url.searchParams.get("limit")),
    cursor,
    dir,
  });

  return json(result);
}

/** GET /logger/:ulid/search?q=... */
export function getSearch(req: Request, ulid: string): Response {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return invalidRequest("q is required");

  const windowRaw = url.searchParams.get("window");
  const window = windowRaw ? parseLogWindow(windowRaw) : null;
  if (windowRaw && !window) {
    return invalidRequest("window must be today, yesterday, or last_7_days");
  }

  const items = searchLogs({
    ulid,
    q,
    window,
    tz: url.searchParams.get("tz") ?? "UTC",
    level: url.searchParams.get("level"),
    component: url.searchParams.get("component"),
    limit: clampLimitParam(url.searchParams.get("limit")),
  });

  return json({ items });
}

/** GET /logger/:ulid/counts?window=... */
export function getCounts(req: Request, ulid: string): Response {
  const logger = getLoggerByUlid(ulid);
  if (!logger) return notFoundUlid();

  const url = new URL(req.url);
  const window = parseLogWindow(url.searchParams.get("window"));
  if (!window) {
    return invalidRequest("window must be today, yesterday, or last_7_days");
  }
  const tz = url.searchParams.get("tz") ?? "UTC";
  const bounds = windowBoundsMs(window, tz);
  return json(getLevelCounts(ulid, bounds));
}
