---
name: loggers
description: Emit, follow, and search structured logs with the `loggers` CLI and `loggers.js` SDK. Use when a project sets LOGGERS_ULID or LOGGERS_NAME, ships a loggers.js, or the user wants to write, tail, search, or configure structured app logs (levels, components, retention).
---

# Loggers

Structured logging for apps and agents. Each line has a **level**
(`debug|info|warn|error`), a **component** tag, and a JSON **data** payload,
written to a logger identified by a 26-char ULID. Use the `loggers` CLI from
a shell, the `loggers.js` SDK from code.

## When to use

- The project has `LOGGERS_ULID` / `LOGGERS_NAME` set, or a `loggers.js`.
- The user wants to emit, tail, or search logs, or set levels/retention.

Skip for plain `console.log` or a different logging library.

## Setup

Target a logger via env (per project) or the config file (global). Resolution
prefers an explicit ULID, then a name looked up in `loggers.yaml`.

- `.env`: `LOGGERS_ULID=<ULID>` **or** `LOGGERS_NAME=<alias>`.
- `LOGGERS_LEVEL=debug|info|warn|error` — minimum level emitted when a call
  doesn't specify one.
- `LOGGERS_DOMAIN` — CLI ingest host (default `https://loggers.dev`); for the
  SDK, pass `endpoint` to `create()` instead.

`loggers.yaml`, looked up at `$LOGGERS_CONFIG_PATH`, then `./loggers.yaml`,
then `~/.config/loggers/loggers.yaml`:

```yaml
timezone: UTC          # day-bucketing for local files (default UTC)
default_level: info    # fallback minimum level for all loggers
loggers:
  api: 01J0…ULID       # shorthand: name → ULID
  worker:
    ulid: 01J0…ULID
    level: warn               # per-logger minimum level
    file_retention_days: 14   # local-file retention for this logger
```

## CLI

`loggers <command>` (defaults to `info`). Globals: `-l <name|ulid>` targets a
logger; `--json` / `--yaml` give machine-readable output.

- `loggers info` — resolved target + latest sample line.
- `loggers log --info "message"` — emit one line (`--debug|--info|--warn|--error`).
- `loggers show [--level L] [--component C]` — list recent logs.
- `loggers grep "timeout"` — case-insensitive substring search.
- `loggers tail` — follow new lines live.
- `loggers alias <name> <ulid> [level]` — save/update a name → ULID mapping.
- `loggers level <name> <level>` — change only a mapping's level.
- `loggers sdk` — download `./loggers.js`.
- `loggers skill` — print this skill.
- `loggers help` — full usage.

## SDK

```js
import { Loggers } from "./loggers.js"; // get it with `loggers sdk`

const log = Loggers.create({
  name: "api",          // or ulid: "01J0…". `name` resolves via env / loggers.yaml
  component: "web",     // tag applied to these lines
  // level: "info",     // per-logger minimum (else LOGGERS_LEVEL / config)
  // local: true,       // also write ./loggers/<name>/<YYYY-MM-DD>.log
  // endpoint: "https://logs.example.com",
});

log.info({ msg: "started", port: 3000 });
log.error({ msg: "db failed", err: String(e) }, "db"); // 2nd arg overrides component

await log.close(); // flush queued lines + stop the timer — call on shutdown
```

- **Methods:** `debug` / `info` / `warn` / `error`(`data`, `componentOverride?`).
  `data` is any JSON object; lines below the minimum level are dropped.
- **Remote by default.** `local: true` (or `local: { dir, retentionDays,
  timezone }`) also writes daily files and prunes them after
  `fileRetentionDays` (default 7) — the retention is yours to set, on your disk.
- **Flushing:** lines batch and flush on a timer. `await log.flush()` sends now;
  `await log.close()` flushes and stops the timer (use at process exit).
- **Redaction:** sensitive keys (`password`, `token`, `secret`, …) are recorded
  as redaction paths in the server-side meta; your `data` is stored verbatim.
