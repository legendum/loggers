#!/usr/bin/env bun

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { YAML } from "bun";

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
const DEFAULT_DOMAIN = "https://loggers.dev";
const DEFAULT_WINDOW = "today";
const DEFAULT_TZ = "UTC";

type Format = "text" | "json" | "yaml";

type Parsed = {
  loggerOverride: string | null;
  command: string | null;
  positional: string[];
  flags: Map<string, string | true>;
};

type ResolveSource = "flag" | ".env" | "global-config" | "prompt";

type ResolvedTarget = {
  ulid: string;
  source: ResolveSource;
};

type FetchResult = {
  status: number;
  body: string;
};

type LogItem = {
  id: number;
  logged_at: number;
  level: string;
  component: string;
  data: Record<string, unknown>;
};

type LogsResponse = {
  items: LogItem[];
  next_cursor: string | null;
};

function parseArgs(argv: string[]): Parsed {
  const out: Parsed = {
    loggerOverride: null,
    command: null,
    positional: [],
    flags: new Map(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-l" || a === "--logger") {
      out.loggerOverride = argv[++i] ?? "";
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out.flags.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out.flags.set(a.slice(2), next);
        i++;
      } else {
        out.flags.set(a.slice(2), true);
      }
      continue;
    }
    if (out.command === null) {
      out.command = a;
      continue;
    }
    out.positional.push(a);
  }
  return out;
}

function normalizeUlid(raw: string, ctx: string): string {
  const ulid = raw.trim().toUpperCase();
  if (!ULID_RE.test(ulid)) {
    console.error(
      `${ctx}: invalid logger ULID (expected 26-char Crockford ULID)`,
    );
    process.exit(2);
  }
  return ulid;
}

function readLineSync(): string {
  const fd = openSync("/dev/tty", "r");
  const buf = Buffer.alloc(1024);
  const n = readSync(fd, buf, 0, buf.length, null);
  closeSync(fd);
  return buf.toString("utf-8", 0, n).replace(/\r?\n$/, "");
}

function projectEnvPath(): string {
  return join(process.cwd(), ".env");
}

function getProjectEnvUlid(): string | null {
  const path = projectEnvPath();
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf-8").match(/^LOGGERS_ULID=(.+)$/m);
  return m?.[1]?.trim() || null;
}

function saveProjectEnvUlid(ulid: string): void {
  const path = projectEnvPath();
  const next = `LOGGERS_ULID=${ulid}`;
  if (!existsSync(path)) {
    writeFileSync(path, `${next}\n`, "utf-8");
    return;
  }
  const current = readFileSync(path, "utf-8");
  if (/^LOGGERS_ULID=/m.test(current)) {
    writeFileSync(path, current.replace(/^LOGGERS_ULID=.*$/m, next), "utf-8");
    return;
  }
  const sep = current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${sep}${next}\n`, "utf-8");
}

function globalConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "loggers", "loggers.yaml");
  const home = process.env.HOME?.trim() ?? "~";
  return join(home, ".config", "loggers", "loggers.yaml");
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function getString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function readGlobalConfigUlid(): string | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = YAML.parse(readFileSync(path, "utf-8")) as unknown;
    const root = asObject(parsed);
    if (!root) return null;
    const direct = getString(root.ulid);
    if (direct) return direct;
    const defaults = asObject(root.default);
    if (defaults) {
      const fromDefault = getString(defaults.ulid);
      if (fromDefault) return fromDefault;
    }
    const loggers = asObject(root.loggers);
    if (!loggers) return null;
    const maybeDefault = asObject(loggers.default);
    if (maybeDefault) {
      const fromLoggersDefault = getString(maybeDefault.ulid);
      if (fromLoggersDefault) return fromLoggersDefault;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveTarget(override: string | null): ResolvedTarget {
  if (override) {
    return { ulid: normalizeUlid(override, "-l / --logger"), source: "flag" };
  }
  const env = getProjectEnvUlid();
  if (env) {
    return { ulid: normalizeUlid(env, "LOGGERS_ULID in .env"), source: ".env" };
  }
  const fromGlobalConfig = readGlobalConfigUlid();
  if (fromGlobalConfig) {
    return {
      ulid: normalizeUlid(fromGlobalConfig, `${globalConfigPath()} ulid`),
      source: "global-config",
    };
  }
  if (!process.stdin.isTTY) {
    console.error(
      "LOGGERS_ULID not set. Use -l <ulid>, set LOGGERS_ULID in .env, or set ulid in ~/.config/loggers/loggers.yaml.",
    );
    process.exit(2);
  }
  process.stdout.write("Enter your logger ULID: ");
  const raw = readLineSync().trim();
  if (!raw) {
    console.error("No ULID provided.");
    process.exit(2);
  }
  const ulid = normalizeUlid(raw, "Logger ULID");
  saveProjectEnvUlid(ulid);
  return { ulid, source: "prompt" };
}

function domainBase(): string {
  const raw = process.env.LOGGERS_DOMAIN?.trim() || DEFAULT_DOMAIN;
  return raw.replace(/\/+$/, "");
}

function loggerBaseUrl(ulid: string): string {
  return `${domainBase()}/logger/${ulid}`;
}

function pickFormat(flags: Parsed["flags"]): Format {
  if (flags.has("json")) return "json";
  if (flags.has("yaml")) return "yaml";
  return "text";
}

function parseJSON(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function dieFromHttp(res: FetchResult): never {
  const parsed = parseJSON(res.body);
  const obj = asObject(parsed);
  const msg =
    getString(obj?.message) ||
    getString(obj?.error) ||
    res.body ||
    `HTTP ${res.status}`;
  console.error(`Error (${res.status}): ${msg}`);
  process.exit(2);
}

async function request(
  url: string,
  method: string,
  init: { body?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body: init.body,
      headers: init.headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Network error: ${msg}`);
    process.exit(2);
  }
  return { status: res.status, body: await res.text() };
}

function summarizeData(data: Record<string, unknown>): string {
  const msg = getString(data.msg);
  if (msg) return msg;
  try {
    const s = JSON.stringify(data);
    return s.length > 140 ? `${s.slice(0, 139)}…` : s;
  } catch {
    return "{}";
  }
}

function formatLogItem(it: LogItem): string {
  const iso = new Date(it.logged_at).toISOString();
  return `${iso}  ${it.level.toUpperCase().padEnd(5)}  ${it.component}  ${summarizeData(it.data)}`;
}

function asLogItem(v: unknown): LogItem | null {
  const row = asObject(v);
  if (!row) return null;
  if (
    typeof row.id !== "number" ||
    typeof row.logged_at !== "number" ||
    typeof row.level !== "string" ||
    typeof row.component !== "string"
  ) {
    return null;
  }
  const data = asObject(row.data) ?? {};
  return {
    id: row.id,
    logged_at: row.logged_at,
    level: row.level,
    component: row.component,
    data,
  };
}

function asLogsResponse(v: unknown): LogsResponse | null {
  const obj = asObject(v);
  if (!obj || !Array.isArray(obj.items)) return null;
  const items: LogItem[] = [];
  for (const raw of obj.items) {
    const item = asLogItem(raw);
    if (!item) return null;
    items.push(item);
  }
  const next =
    obj.next_cursor === null || typeof obj.next_cursor === "string"
      ? obj.next_cursor
      : null;
  return { items, next_cursor: next };
}

function logsQuery(parsed: Parsed, includeQuery = false): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("window", String(parsed.flags.get("window") ?? DEFAULT_WINDOW));
  qs.set("tz", String(parsed.flags.get("tz") ?? DEFAULT_TZ));
  qs.set("limit", String(parsed.flags.get("limit") ?? "100"));
  const level = parsed.flags.get("level");
  if (typeof level === "string" && level) qs.set("level", level);
  const component = parsed.flags.get("component");
  if (typeof component === "string" && component)
    qs.set("component", component);
  const cursor = parsed.flags.get("cursor");
  if (typeof cursor === "string" && cursor) qs.set("cursor", cursor);
  if (includeQuery) {
    const q = parsed.positional.join(" ").trim();
    if (q) qs.set("q", q);
  }
  return qs;
}

function printPayload(payload: unknown, format: Format): void {
  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (format === "yaml") {
    console.log(YAML.stringify(payload, null, 2));
    return;
  }
  const logs = asLogsResponse(payload);
  if (!logs) {
    console.log(String(payload));
    return;
  }
  if (logs.items.length === 0) {
    console.log("(no logs)");
  } else {
    for (const it of logs.items) console.log(formatLogItem(it));
  }
  if (logs.next_cursor) {
    console.log(`\nnext_cursor: ${logs.next_cursor}`);
  }
}

function nextCursorFromItems(items: LogItem[]): string | null {
  const last = items[items.length - 1];
  if (!last) return null;
  return `${last.logged_at}:${last.id}`;
}

async function cmdSdk(parsed: Parsed): Promise<number> {
  const target = join(process.cwd(), "loggers.js");
  const force = parsed.flags.has("force");
  if (existsSync(target) && !force) {
    console.error("loggers.js already exists in this folder (use --force).");
    return 2;
  }
  const url = `${domainBase()}/loggers.js`;
  const res = await request(url, "GET");
  if (res.status !== 200) dieFromHttp(res);
  writeFileSync(target, res.body, "utf-8");
  console.log(`Wrote ${target}`);
  return 0;
}

async function cmdInfo(
  baseUrl: string,
  target: ResolvedTarget,
): Promise<number> {
  const res = await request(
    `${baseUrl}/logs?window=${DEFAULT_WINDOW}&tz=${DEFAULT_TZ}&limit=1`,
    "GET",
  );
  if (res.status === 404) {
    console.error("Logger not found for this ULID.");
    return 1;
  }
  if (res.status !== 200) dieFromHttp(res);
  const parsed = parseJSON(res.body);
  const logs = asLogsResponse(parsed);
  const newest = logs?.items[logs.items.length - 1] ?? null;
  console.log(`domain: ${domainBase()}`);
  console.log(`ulid:   ${target.ulid}`);
  console.log(`source: ${target.source}`);
  if (newest) {
    console.log(
      `latest: ${new Date(newest.logged_at).toISOString()} ${newest.level}`,
    );
  } else {
    console.log("latest: (no logs in current window)");
  }
  return 0;
}

async function cmdShow(baseUrl: string, parsed: Parsed): Promise<number> {
  const qs = logsQuery(parsed);
  const res = await request(`${baseUrl}/logs?${qs.toString()}`, "GET");
  if (res.status !== 200) dieFromHttp(res);
  const payload = parseJSON(res.body);
  printPayload(payload, pickFormat(parsed.flags));
  return 0;
}

async function cmdGrep(baseUrl: string, parsed: Parsed): Promise<number> {
  const query = parsed.positional.join(" ").trim();
  if (!query) {
    console.error("grep: missing query");
    return 2;
  }
  const qs = logsQuery(parsed, true);
  const res = await request(`${baseUrl}/search?${qs.toString()}`, "GET");
  if (res.status !== 200) dieFromHttp(res);
  const parsedBody = parseJSON(res.body);
  const obj = asObject(parsedBody);
  const payload: LogsResponse = {
    items: Array.isArray(obj?.items)
      ? obj.items
          .map((it) => asLogItem(it))
          .filter((v): v is LogItem => v !== null)
      : [],
    next_cursor: null,
  };
  printPayload(payload, pickFormat(parsed.flags));
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cmdTail(baseUrl: string, parsed: Parsed): Promise<number> {
  const interval = Number(parsed.flags.get("interval") ?? "2000");
  const delayMs = Number.isFinite(interval) ? Math.max(500, interval) : 2000;
  let cursor =
    typeof parsed.flags.get("cursor") === "string"
      ? String(parsed.flags.get("cursor"))
      : null;
  while (true) {
    const qs = logsQuery(parsed);
    if (cursor) qs.set("cursor", cursor);
    const res = await request(`${baseUrl}/logs?${qs.toString()}`, "GET");
    if (res.status !== 200) dieFromHttp(res);
    const payload = asLogsResponse(parseJSON(res.body));
    if (!payload) {
      console.error("Unexpected /logs payload.");
      return 2;
    }
    if (payload.items.length > 0) {
      for (const it of payload.items) console.log(formatLogItem(it));
      cursor = payload.next_cursor ?? nextCursorFromItems(payload.items);
    } else if (payload.next_cursor) {
      cursor = payload.next_cursor;
    }
    await sleep(delayMs);
  }
}

function cmdHelp(): number {
  console.log(`loggers — query and tail a logger by ULID

Usage:
  loggers                          info
  loggers info                     show resolved logger target + latest sample
  loggers sdk [--force]            download /loggers.js into ./loggers.js
  loggers show [--window today|yesterday|last_7_days] [--limit N] [--level L] [--component C] [--cursor C] [--tz TZ]
  loggers grep <query> [--window ...] [--limit N] [--level L] [--component C] [--tz TZ]
  loggers tail [--window ...] [--interval MS] [--level L] [--component C] [--tz TZ]
  loggers help

Global:
  -l, --logger <ulid>              override target ULID for this call
  --json | --yaml                  structured output for show/grep

ULID target precedence:
  1) -l / --logger
  2) LOGGERS_ULID in ./.env
  3) ulid in ${globalConfigPath()}
  4) interactive prompt (saved back to ./.env)
`);
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = (parsed.command ?? "info").toLowerCase();

  if (cmd === "help" || parsed.flags.has("help") || parsed.flags.has("h")) {
    process.exit(cmdHelp());
  }
  if (cmd === "sdk") {
    process.exit(await cmdSdk(parsed));
  }

  const target = resolveTarget(parsed.loggerOverride);
  const baseUrl = loggerBaseUrl(target.ulid);

  let code = 0;
  switch (cmd) {
    case "info":
      code = await cmdInfo(baseUrl, target);
      break;
    case "show":
      code = await cmdShow(baseUrl, parsed);
      break;
    case "grep":
      code = await cmdGrep(baseUrl, parsed);
      break;
    case "tail":
      code = await cmdTail(baseUrl, parsed);
      break;
    default:
      console.error(`Unknown command: ${cmd}. Try 'loggers help'.`);
      code = 2;
      break;
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
