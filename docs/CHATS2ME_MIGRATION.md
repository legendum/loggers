# Chats2Me -> Loggers Migration Spec

Migrate `../chats2me` logging from local Pino-only files to the new `loggers` service model, while preserving operational visibility and low-risk rollout.

This document is intentionally implementation-focused and complements `docs/SPEC.md`.

---

## 1. Goals

- Adopt `loggers` as the primary centralized logging backend for `chats2me`.
- Keep local file logs via SDK sink for operational debugging on host machines.
- Preserve or improve current privacy posture (no raw IPs, no message content).
- Improve level fidelity so Logs UI counts (`D I W E`) are meaningful.
- Minimize migration risk via phased rollout and fast rollback.

---

## 2. Non-goals (v1)

- Rewriting all historical local log files into Loggers.
- Defining new log taxonomy for every feature area from scratch.
- Introducing custom log levels beyond `debug|info|warn|error`.
- Replacing chats2me product analytics or usage billing tables.

---

## 3. Current Chats2Me Logging (baseline)

- Structured JSON logs are written locally through `src/lib/logger.ts` (Pino).
- Daily files are currently under `log/YYYY-MM-DD.log` (UTC).
- Structured event helper `logEvent()` is used by API/audit paths.
- Many modules already include `module` fields via `logger.child({ module: ... })`.
- Important gap: `logEvent()` currently emits everything at `info`.

Migration must preserve the useful current fields while normalizing into Loggers schema:

- `level`
- `component`
- `logged_at`
- `data` (with server-derived `meta` handled by Loggers)

---

## 4. Target Architecture

### 4.1 Logging path

`chats2me code -> loggers SDK adapter ->`
- remote ingest (`POST /logger/:ulid/batch`)
- local daily file sink (`loggers/<name>/YYYY-MM-DD.log`) per `loggers.yaml`

### 4.2 Config

`chats2me` runtime uses `loggers.yaml` for:

- logger name -> ULID mapping
- default/per-logger level controls
- per-logger local file retention (`file_retention_days`)
- timezone (default `UTC`)

---

## 5. Logger Names and Components

### 5.1 Proposed logger names in `loggers.yaml`

- `chats2me_api`
- `chats2me_ai`
- `chats2me_tools`
- `chats2me_jobs`
- `chats2me_telegram`
- `chats2me_scheduler`
- `chats2me_server`
- `chats2me_crypto`
- `chats2me_geo`

### 5.2 Component mapping

Component should be stable and low-cardinality. Use:

- `api`, `ai`, `tools`, `jobs`, `telegram`, `scheduler`, `server`, `crypto`, `geo`

For module-specific detail, keep richer data in `data.module` or `meta.module` instead of exploding component cardinality.

---

## 6. Level Mapping Rules

Set effective level at call site when possible; otherwise derive in adapter.

### 6.1 HTTP/access events

- `kind=http` with status `200-399` -> `info`
- `kind=http` with status `400-499` -> `warn`
- `kind=http` with status `500-599` -> `error`
- `kind=http_error` -> `error`

### 6.2 AI/tool/audit events

- `ok=true` -> `info`
- `ok=false` and recoverable/user-correctable -> `warn`
- `ok=false` and system/provider failure -> `error`

### 6.3 Native logger calls

`logger.info/warn/error/debug` should map 1:1 to Loggers levels.

---

## 7. Timestamp and Ordering

- SDK must set `logged_at` at log-call time (client side).
- `logged_at` is canonical event time.
- Loggers server receipt time remains operational metadata only.
- Batching must not alter `logged_at`.

---

## 8. Data and Privacy Rules

- Keep "no message content in logs" policy unchanged.
- Keep anonymized IP behavior unchanged before emitting.
- Redact sensitive URL/query/body fragments before sending.
- Keep payloads structured JSON; avoid free-form stack dumps unless needed.

Recommended redaction keys:
- `authorization`, `token`, `api_key`, `password`, `secret`, `cookie`

---

## 9. `loggers.yaml` Example (Chats2Me)

```yaml
timezone: UTC
default_level: info
loggers:
  chats2me_api:
    ulid: 01JAAAAAAAAAAAAAAAAAAAAAAA
    level: info
    file_retention_days: 7
  chats2me_ai:
    ulid: 01JBBBBBBBBBBBBBBBBBBBBBBB
    level: info
    file_retention_days: 7
  chats2me_tools:
    ulid: 01JCCCCCCCCCCCCCCCCCCCCCCC
    level: info
    file_retention_days: 7
  chats2me_jobs:
    ulid: 01JDDDDDDDDDDDDDDDDDDDDDDD
    level: info
    file_retention_days: 14
  chats2me_telegram:
    ulid: 01JEEEEEEEEEEEEEEEEEEEEEEE
    level: warn
    file_retention_days: 7
  chats2me_scheduler:
    ulid: 01JFFFFFFFFFFFFFFFFFFFFFFF
    level: info
    file_retention_days: 7
  chats2me_server:
    ulid: 01JGGGGGGGGGGGGGGGGGGGGGGG
    level: info
    file_retention_days: 7
  chats2me_crypto:
    ulid: 01JHHHHHHHHHHHHHHHHHHHHHHH
    level: warn
    file_retention_days: 7
  chats2me_geo:
    ulid: 01JIIIIIIIIIIIIIIIIIIIIIII
    level: warn
    file_retention_days: 7
```

---

## 10. Implementation Plan

### Phase 0 - Setup

- Create required loggers in Loggers UI/API.
- Add `loggers.yaml` to chats2me runtime environment.
- Add download/integration of `loggers.js`.

### Phase 1 - Adapter

- Introduce a single chats2me logging adapter:
  - `emit({ loggerName, component, level, data })`
- Adapter responsibilities:
  - set `logged_at`
  - apply level mapping fallback
  - apply redaction
  - batch + flush using SDK defaults

### Phase 2 - Callsite migration

- Migrate `logEvent()` first (highest coverage).
- Migrate direct root logger calls lacking explicit component.
- Keep existing module child logging but route through adapter where practical.

### Phase 3 - Validation and cutover

- Verify Loggers UI counts and filters for each logger/component.
- Verify local sink files under `loggers/<name>/YYYY-MM-DD.log`.
- Disable old Pino-only sink path after parity is proven.

### Phase 4 - Cleanup

- Remove dead logging utilities and stale env vars.
- Update chats2me docs to reference Loggers + `loggers.yaml`.

---

## 11. Test Plan

- Unit: level mapper (`kind/status/ok` -> level).
- Unit: component resolver.
- Unit: redaction guard.
- Unit: `logged_at` set at call time and preserved through batch flush.
- Integration: emits appear in Loggers with expected level/component.
- Integration: local files rotate daily and retention cleanup works.
- Regression: no message content leaked in emitted payloads.

---

## 12. Rollback Plan

- Feature flag in adapter:
  - `LOGGERS_ENABLED=true|false`
- If disabled:
  - continue local file logging only
  - no remote ingest attempts
- Keep old logger path available for one release window during migration.

---

## 13. Acceptance Criteria

- All priority chats2me logging paths emit to Loggers with valid:
  - `level`, `component`, `logged_at`, `data`
- `D I W E` distribution is meaningful (errors/warnings no longer flattened to info).
- `loggers.yaml` controls level and retention as specified.
- Local file sink exists per logger name/day.
- Privacy guarantees remain intact (no raw IP, no message content, secret redaction).
