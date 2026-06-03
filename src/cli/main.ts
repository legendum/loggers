#!/usr/bin/env bun

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import {
  asObject,
  dieFromHttp,
  getString,
  globalConfigPath,
  installSkill,
  normalizeUlid,
  type ParsedArgs,
  parseArgs,
  parseJSON,
  pickFormat,
  readGlobalConfig,
  readLineSync,
  readProjectValue,
  readStdin,
  request,
  skillSourceCandidates,
  ULID_RE,
  writeGlobalConfig,
  writeProjectValue,
} from "pues/base/cli/server";

const APP = "loggers";
const DEFAULT_DOMAIN = "https://loggers.dev";
const DEFAULT_ALIAS_NAME = "loggers.dev";
const DEFAULT_WINDOW = "today";
const DEFAULT_TZ = "UTC";
const BOOLEAN_FLAGS = new Set([
  "h",
  "help",
  "json",
  "yaml",
  "force",
  "debug",
  "info",
  "warn",
  "error",
]);
const LOG_LEVEL_FLAGS = ["debug", "info", "warn", "error"] as const;

type ResolveSource =
  | "flag"
  | "flag-name"
  | ".env"
  | ".env-name"
  | "global-config"
  | "prompt";

type ResolvedTarget = {
  ulid: string;
  source: ResolveSource;
  name: string | null;
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

type LogLevel = (typeof LOG_LEVEL_FLAGS)[number];

function parseNamedLevel(raw: string, ctx: string): LogLevel | null {
  const level = raw.trim().toLowerCase();
  if ((LOG_LEVEL_FLAGS as readonly string[]).includes(level)) {
    return level as LogLevel;
  }
  console.error(`${ctx}: invalid level (expected debug|info|warn|error)`);
  return null;
}

function parseConfiguredLevel(raw: string | null | undefined): LogLevel | null {
  if (!raw) return null;
  const level = raw.trim().toLowerCase();
  if ((LOG_LEVEL_FLAGS as readonly string[]).includes(level)) {
    return level as LogLevel;
  }
  return null;
}

function getProjectEnvUlid(): string | null {
  return readProjectValue("LOGGERS_ULID");
}

function getProjectEnvName(): string | null {
  return readProjectValue("LOGGERS_NAME");
}

function getProjectEnvLevel(): LogLevel | null {
  return parseConfiguredLevel(readProjectValue("LOGGERS_LEVEL"));
}

function saveProjectEnvUlid(ulid: string): void {
  writeProjectValue("LOGGERS_ULID", ulid);
}

function readGlobalConfigRoot(): Record<string, unknown> | null {
  return readGlobalConfig(APP);
}

function writeGlobalConfigRoot(root: Record<string, unknown>): string {
  return writeGlobalConfig(APP, root);
}

function readGlobalConfigUlid(): string | null {
  const root = readGlobalConfigRoot();
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
  const maybeAlias = asObject(loggers[DEFAULT_ALIAS_NAME]);
  if (maybeAlias) {
    const fromAlias = getString(maybeAlias.ulid);
    if (fromAlias) return fromAlias;
  }
  const maybeAliasString = getString(loggers[DEFAULT_ALIAS_NAME]);
  if (maybeAliasString) return maybeAliasString;
  return null;
}

function readGlobalLoggerAliasUlid(name: string): string | null {
  const root = readGlobalConfigRoot();
  if (!root) return null;
  const loggers = asObject(root.loggers);
  if (!loggers) return null;
  const raw = loggers[name];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const entry = asObject(raw);
  return getString(entry?.ulid);
}

function readGlobalLoggerAliasLevel(name: string): LogLevel | null {
  const root = readGlobalConfigRoot();
  if (!root) return null;
  const loggers = asObject(root.loggers);
  if (!loggers) return null;
  const entry = asObject(loggers[name]);
  if (!entry) return null;
  return parseConfiguredLevel(getString(entry.level));
}

function readGlobalLevelByUlid(ulid: string): LogLevel | null {
  const root = readGlobalConfigRoot();
  if (!root) return null;
  const loggers = asObject(root.loggers);
  if (!loggers) return null;
  for (const raw of Object.values(loggers)) {
    const entry = asObject(raw);
    if (!entry) continue;
    const entryUlid = getString(entry.ulid);
    if (!entryUlid) continue;
    if (entryUlid.trim().toUpperCase() !== ulid.trim().toUpperCase()) continue;
    return parseConfiguredLevel(getString(entry.level));
  }
  return null;
}

function readGlobalDefaultLevel(): LogLevel | null {
  const root = readGlobalConfigRoot();
  if (!root) return null;
  const fromTop = parseConfiguredLevel(getString(root.default_level));
  if (fromTop) return fromTop;
  const defaults = asObject(root.default);
  if (!defaults) return null;
  return parseConfiguredLevel(getString(defaults.level));
}

function validateAliasName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) ? name : null;
}

function resolveTarget(override: string | null): ResolvedTarget {
  if (override) {
    const maybeUlid = override.trim().toUpperCase();
    if (ULID_RE.test(maybeUlid)) {
      return {
        ulid: normalizeUlid(maybeUlid, "-l / --logger"),
        source: "flag",
        name: null,
      };
    }
    const fromAlias = readGlobalLoggerAliasUlid(override.trim());
    if (fromAlias) {
      return {
        ulid: normalizeUlid(
          fromAlias,
          `${globalConfigPath(APP)} loggers.${override.trim()}.ulid`,
        ),
        source: "flag-name",
        name: override.trim(),
      };
    }
    console.error(
      `-l / --logger: unknown logger '${override}'. Pass a ULID or add alias via 'loggers alias <name> <ulid>'.`,
    );
    process.exit(2);
  }
  const env = getProjectEnvUlid();
  if (env) {
    return {
      ulid: normalizeUlid(env, "LOGGERS_ULID in .env"),
      source: ".env",
      name: null,
    };
  }
  const envName = getProjectEnvName();
  if (envName) {
    const fromAlias = readGlobalLoggerAliasUlid(envName);
    if (fromAlias) {
      return {
        ulid: normalizeUlid(
          fromAlias,
          `${globalConfigPath(APP)} loggers.${envName}.ulid`,
        ),
        source: ".env-name",
        name: envName,
      };
    }
    console.error(
      `LOGGERS_NAME in .env: unknown logger '${envName}'. Add alias via 'loggers alias <name> <ulid> [level]'.`,
    );
    process.exit(2);
  }
  const fromGlobalConfig = readGlobalConfigUlid();
  if (fromGlobalConfig) {
    return {
      ulid: normalizeUlid(fromGlobalConfig, `${globalConfigPath(APP)} ulid`),
      source: "global-config",
      name: null,
    };
  }
  if (!process.stdin.isTTY) {
    console.error(
      "LOGGERS_ULID not set. Use -l <ulid|name>, set LOGGERS_ULID or LOGGERS_NAME in .env, or set ulid in ~/.config/loggers/loggers.yaml.",
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
  return { ulid, source: "prompt", name: null };
}

function domainBase(): string {
  const raw = process.env.LOGGERS_DOMAIN?.trim() || DEFAULT_DOMAIN;
  return raw.replace(/\/+$/, "");
}

function loggerBaseUrl(ulid: string): string {
  return `${domainBase()}/logger/${ulid}`;
}

function parseJsonInput(
  body: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
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

function logsQuery(parsed: ParsedArgs, includeQuery = false): URLSearchParams {
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

function printPayload(
  payload: unknown,
  format: "text" | "json" | "yaml",
): void {
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

async function cmdSdk(parsed: ParsedArgs): Promise<number> {
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

function cmdSkill(): number {
  const repoRoot = dirname(dirname(import.meta.dir));
  installSkill({ app: APP, sources: skillSourceCandidates(APP, repoRoot) });
  return 0;
}

function cmdAlias(parsed: ParsedArgs): number {
  const nameRaw = parsed.positional[0] ?? "";
  const ulidRaw = parsed.positional[1] ?? "";
  const levelRaw = parsed.positional[2];
  if (!nameRaw || !ulidRaw || parsed.positional.length > 3) {
    console.error("alias: usage: loggers alias <name> <ulid> [level]");
    return 2;
  }
  const name = validateAliasName(nameRaw);
  if (!name) {
    console.error(
      "alias: invalid name. Use 1-64 chars: letters, numbers, dot, underscore, dash.",
    );
    return 2;
  }
  const ulid = normalizeUlid(ulidRaw, "alias <ulid>");
  let level: LogLevel | null = null;
  if (typeof levelRaw === "string") {
    level = parseNamedLevel(levelRaw, "alias <level>");
    if (!level) return 2;
  }
  const root = readGlobalConfigRoot() ?? {};
  let loggers = asObject(root.loggers);
  if (!loggers) {
    loggers = {};
    root.loggers = loggers;
  }
  const existing = asObject(loggers[name]);
  const priorLevel =
    typeof existing?.level === "string" &&
    (LOG_LEVEL_FLAGS as readonly string[]).includes(existing.level)
      ? (existing.level as LogLevel)
      : null;
  const finalLevel = level ?? priorLevel ?? "info";
  if (existing) {
    existing.ulid = ulid;
    existing.level = finalLevel;
    loggers[name] = existing;
  } else {
    loggers[name] = { ulid, level: finalLevel };
  }
  const path = writeGlobalConfigRoot(root);
  console.log(
    `saved alias '${name}' -> ${ulid} level=${finalLevel} in ${path}`,
  );
  return 0;
}

function cmdLevel(parsed: ParsedArgs): number {
  const nameRaw = parsed.positional[0] ?? "";
  const levelRaw = parsed.positional[1] ?? "";
  if (!nameRaw || !levelRaw || parsed.positional.length > 2) {
    console.error("level: usage: loggers level <name> <level>");
    return 2;
  }
  const name = validateAliasName(nameRaw);
  if (!name) {
    console.error(
      "level: invalid name. Use 1-64 chars: letters, numbers, dot, underscore, dash.",
    );
    return 2;
  }
  const level = parseNamedLevel(levelRaw, "level <level>");
  if (!level) return 2;

  const root = readGlobalConfigRoot() ?? {};
  let loggers = asObject(root.loggers);
  if (!loggers) {
    loggers = {};
    root.loggers = loggers;
  }
  const existing = asObject(loggers[name]);
  if (existing) {
    existing.level = level;
    loggers[name] = existing;
  } else {
    loggers[name] = { level };
  }
  const path = writeGlobalConfigRoot(root);
  console.log(`saved level '${name}' -> ${level} in ${path}`);
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

async function cmdShow(baseUrl: string, parsed: ParsedArgs): Promise<number> {
  const qs = logsQuery(parsed);
  const res = await request(`${baseUrl}/logs?${qs.toString()}`, "GET");
  if (res.status !== 200) dieFromHttp(res);
  const payload = parseJSON(res.body);
  printPayload(payload, pickFormat(parsed.flags));
  return 0;
}

async function cmdGrep(baseUrl: string, parsed: ParsedArgs): Promise<number> {
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

async function cmdTail(baseUrl: string, parsed: ParsedArgs): Promise<number> {
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

function resolveLogLevel(
  parsed: ParsedArgs,
  target: ResolvedTarget,
): LogLevel | null {
  const selected = LOG_LEVEL_FLAGS.filter((level) => parsed.flags.has(level));
  if (selected.length > 1) {
    console.error("log: pass only one of --debug, --info, --warn, --error");
    return null;
  }
  if (selected.length === 1) return selected[0] ?? null;
  const envLevel = getProjectEnvLevel();
  if (envLevel) return envLevel;
  if (target.name) {
    const byName = readGlobalLoggerAliasLevel(target.name);
    if (byName) return byName;
  }
  const byUlid = readGlobalLevelByUlid(target.ulid);
  if (byUlid) return byUlid;
  const byDefault = readGlobalDefaultLevel();
  if (byDefault) return byDefault;
  return "info";
}

function resolveLogData(raw: string): Record<string, unknown> {
  const parsed = parseJsonInput(raw);
  if (!parsed.ok) return { text: raw };
  const obj = asObject(parsed.value);
  if (obj) return obj;
  return { value: parsed.value };
}

async function cmdLog(
  baseUrl: string,
  parsed: ParsedArgs,
  target: ResolvedTarget,
): Promise<number> {
  const level = resolveLogLevel(parsed, target);
  if (!level) return 2;

  const fromArg = parsed.positional.join(" ").trim();
  const fromStdin = fromArg ? "" : (await readStdin()).trim();
  const raw = fromArg || fromStdin;
  if (!raw) {
    console.error("log: missing payload text or JSON");
    return 2;
  }

  const componentRaw = parsed.flags.get("component");
  const component =
    typeof componentRaw === "string" && componentRaw.trim()
      ? componentRaw.trim()
      : "cli";

  const payload = {
    level,
    component,
    data: resolveLogData(raw),
    logged_at: Date.now(),
  };

  const res = await request(`${baseUrl}/ingest`, "POST", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status !== 201) dieFromHttp(res);
  const row = asObject(parseJSON(res.body));
  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(row ?? payload, null, 2));
    return 0;
  }
  if (parsed.flags.has("yaml")) {
    console.log(YAML.stringify(row ?? payload, null, 2));
    return 0;
  }
  const id = typeof row?.id === "number" ? row.id : "?";
  console.log(`logged ${level} line id=${id}`);
  return 0;
}

function cmdHelp(): number {
  console.log(`loggers — query and tail a logger by ULID

Usage:
  loggers                          info
  loggers info                     show resolved logger target + latest sample
  loggers sdk [--force]            download /loggers.js into ./loggers.js
  loggers skill                    install agent skill for Claude / Cursor
  loggers log [--debug|--info|--warn|--error] [--component C] <text-or-json>
  loggers alias <name> <ulid> [level] save/update a logger alias (+ optional level)
  loggers level <name> <level>     save/update logger level in config
  loggers show [--window today|yesterday|last_7_days] [--limit N] [--level L] [--component C] [--cursor C] [--tz TZ]
  loggers grep <query> [--window ...] [--limit N] [--level L] [--component C] [--tz TZ]
  loggers tail [--window ...] [--interval MS] [--level L] [--component C] [--tz TZ]
  loggers help

Global:
  -l, --logger <ulid|name>         override target ULID by ULID or name
  --json | --yaml                  structured output for show/grep

ULID target precedence:
  1) -l / --logger (ULID or name in global config)
  2) LOGGERS_ULID in ./.env
  3) LOGGERS_NAME in ./.env (name in global config)
  4) ulid / default / loggers.${DEFAULT_ALIAS_NAME} in ${globalConfigPath(APP)}
  5) interactive prompt (saved back to ./.env)

loggers log level precedence:
  1) --debug|--info|--warn|--error
  2) LOGGERS_LEVEL in ./.env
  3) loggers.<name>.level (or matching ULID level) in ${globalConfigPath(APP)}
  4) default.level / default_level in ${globalConfigPath(APP)}
  5) info
`);
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), {
    booleanFlags: BOOLEAN_FLAGS,
    shortFlags: { l: "logger" },
  });
  const cmd = (parsed.command ?? "info").toLowerCase();

  if (cmd === "help" || parsed.flags.has("help") || parsed.flags.has("h")) {
    process.exit(cmdHelp());
  }
  if (cmd === "sdk") {
    process.exit(await cmdSdk(parsed));
  }
  if (cmd === "skill") {
    process.exit(cmdSkill());
  }
  if (cmd === "alias") {
    process.exit(cmdAlias(parsed));
  }
  if (cmd === "level") {
    process.exit(cmdLevel(parsed));
  }

  const overrideRaw = parsed.flags.get("logger");
  const override = typeof overrideRaw === "string" ? overrideRaw : null;
  const target = resolveTarget(override);
  const baseUrl = loggerBaseUrl(target.ulid);

  let code = 0;
  switch (cmd) {
    case "info":
      code = await cmdInfo(baseUrl, target);
      break;
    case "log":
      code = await cmdLog(baseUrl, parsed, target);
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
