# Loggers — Product Spec

A minimal PWA + SDK + CLI: **create loggers -> ingest structured log lines -> query/tail logs by level, component, and search text**. Hosted at **loggers.dev**. Designed for both humans and agents.

This project uses the **pues framework**, including:
- **pues `auth`** for login/session management
- **pues `billing` tabs** for usage charges on log ingestion

Implementation baseline:
- Use **`../fifos` as the main implementation template** (routing style, UI patterns, CLI ergonomics, SSE approach, pues integration style).
- Explicit exceptions for Loggers:
  - **database separation** (control DB + per-logger DB files)
  - **FTS/search indexing** (per-logger FTS5 tables, triggers, and search endpoints)
- Lean into **Pues-first implementation** as much as `fifos`:
  - prefer vendored pues parts over bespoke infra (`auth`, `billing`, `objects`, `sse`, `pwa`, `db`, plus `core/theme/style`)
  - only diverge where Loggers has hard product requirements (per-logger DB split, FTS)

First-client migration reference:
- For adopting Loggers in `../chats2me`, see `docs/CHATS2ME_MIGRATION.md`.

---

## 1. What it does

- **User logs in** via pues auth (Legendum-backed in hosted mode).
- **User creates loggers** (named streams) per project/service.
- **Clients send logs** through a lightweight SDK or direct HTTP.
- **Each log line includes a required `component`** so teams can distinguish system parts (for example `auth`, `api`, `worker`, `cron`) inside the same logger.
- **`data` is client-supplied payload** (what the caller observed).
- **`meta` is server-derived enrichment** (what Loggers infers after post-processing).
- **Users can filter, search (FTS), and tail live updates** in the web UI and API.
- **Logger rows show right-side level counts** in a compact pill: `D I W E`.
- **Counts are color-coded** (same visual approach as `fifos`) for fast scanning.

---

## 2. User flows

### 2.1 Auth (pues auth)

1. User opens `loggers.dev` and signs in through pues auth.
2. Backend uses pues auth middleware/routes for login callback, session cookie, and logout.
3. Hosted mode uses Legendum-linked identity and billing eligibility.
4. Self-hosted mode works without Legendum billing (see §5).

### 2.2 Loggers

1. User lands on dashboard and sees their loggers.
2. User creates a logger with:
   - `name` (display name)
   - `slug` (unique per user)
   - `ulid` (global unguessable ingest/query key)
3. Logger detail screen shows:
   - ingest URL (`/logger/:ulid/ingest`)
   - SDK snippet
   - recent logs, filters, and live tail
4. User can drag/drop loggers on the dashboard to reorder them.

### 2.3 Log ingestion

Clients can write logs in two ways:

- **SDK (primary)**: ergonomic logger client for app code.
- **HTTP (fallback)**: direct `POST /logger/:ulid/ingest` and batch endpoint.
- **SDK config file**: `loggers.yaml` can map friendly logger names to ULIDs so source code does not embed raw ULIDs.

Access model (v1):
- ingest is authorized by logger ULID in the URL, following the same pattern as `fifos`
- no separate per-user API key for ingestion
- no `LOGGERS_API_KEY` requirement in SDK or environment

Each ingested line includes:
- `level`: `debug | info | warn | error`
- `component`: required discriminator for sub-system source (`auth`, `api`, etc.)
- `data`: JSON object from the caller
- `logged_at`: required client-side event timestamp (unix epoch ms), set by SDK at log-call time

Level policy (v1):
- allowed levels are exactly `debug`, `info`, `warn`, `error`
- API rejects unknown levels with `400 invalid_request`
- no additional custom levels in v1

Timestamp policy (v1):
- `logged_at` is the canonical event time for ordering/filtering in UI and API
- `logged_at` must be produced client-side (not assigned by server)
- server may additionally store receipt time for observability and debugging

### 2.4 Post-processing (`data` -> `meta`)

After ingest, Loggers runs post-processing to derive server-side `meta`:

- normalize and validate shape
- extract canonical fields (for example request IDs, actor IDs, route names)
- classify/error-tag lines
- add indexing hints and searchable text fragments

`meta` is owned by the platform and may evolve without SDK API breaks.

### 2.5 Search and tail

- Filter by level, component, and date window presets (`Today`, `Yesterday`, `Last 7 days`).
- Full-text search over normalized log text via SQLite FTS5.
- Live tail via SSE stream on logger detail view.
- SSE tail is **batched** (not one-message-per-log-line) for high-volume workloads.
- Log list ordering is chronological by `logged_at` (oldest -> newest).

---

## 3. Data model

We keep one control database plus one per-logger event database.

### 3.1 Control DB (`data/loggers.db`)

- **users**: identity/session owner (from pues auth conventions).
- **loggers**:
  - `id` (PK)
  - `user_id` (FK)
  - `name`
  - `slug` (UNIQUE per user)
  - `ulid` (UNIQUE global)
  - `position` (INTEGER, user-defined ordering)
  - `created_at`
  - `updated_at`
- **logger** (well-known internal sink table for Loggers service failures; dogfooding path):
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `logged_at` INTEGER NOT NULL (event time, unix epoch ms)
  - `created_at` INTEGER (receipt time, unix epoch seconds)
  - `updated_at` INTEGER (unix epoch seconds)
  - `level` TEXT CHECK (`debug`,`info`,`warn`,`error`)
  - `component` TEXT NOT NULL (usually `loggers` or `loggers.<subsystem>`)
  - `data` TEXT NOT NULL (JSON failure payload)
  - `meta` TEXT NOT NULL (JSON derived details)

The control DB `logger` table is reserved for internal operational failures in the Loggers service itself (not tenant application logs).

### 3.2 Per-logger DB (`data/loggers/<ulid>.db`)

Required server-side hierarchy (v1):
- control DB: `data/loggers.db`
- per-logger DBs: `data/loggers/<ulid>.db`
- one SQLite file per logger ULID (no nested subfolders per logger in v1)

Table: **`logger`**

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `logged_at` INTEGER NOT NULL (client event time, unix epoch ms)
- `created_at` INTEGER (server receipt time, unix epoch seconds)
- `updated_at` INTEGER (unix epoch seconds)
- `level` TEXT CHECK (`debug`,`info`,`warn`,`error`)
- `component` TEXT NOT NULL  **<- discriminator for auth/api/etc**
- `data` TEXT NOT NULL       (JSON from client SDK/caller)
- `meta` TEXT NOT NULL       (JSON derived by server post-processing)

Indexes (event-time oriented):

- `(logged_at)`
- `(level, logged_at)`
- `(component, logged_at)`

### 3.3 FTS5 (per-logger DB)

Following the proven `wikis` pattern, each logger DB includes:

```sql
CREATE VIRTUAL TABLE logger_fts USING fts5(
  component,
  data_text,
  meta_text,
  content=logger,
  content_rowid=id,
  tokenize='porter unicode61'
);
```

And triggers to keep FTS in sync on INSERT/UPDATE/DELETE.

`data_text` and `meta_text` are normalized text projections derived from JSON for search.

---

## 4. Architecture decisions

### 4.1 Many databases open at once

Do not keep all per-logger databases open indefinitely.

Use a **connection cache with LRU eviction**:
- max open handles (default 32)
- idle timeout (default 60s)
- reopen on demand

SQLite remains in WAL mode for concurrency.

### 4.2 Redis buffering

**v1: no Redis required.**

Use direct SQLite writes with optional small in-process batch flush. Add Redis later only if production write throughput requires external buffering.

### 4.3 Internal failure logging (dogfood)

When Loggers fails to ingest/write/query through normal per-logger flow, it should record that failure in the well-known control DB table:

- target: `data/loggers.db` -> table `logger`
- include failure context in `data` (operation, ulid, error class/message, request metadata)
- include derived tags in `meta` for later filtering/search
- use level `error` by default (`warn` for recoverable/transient cases)

Recursion guard:
- if writing to the control DB `logger` table fails, do not recurse into another Loggers write attempt
- emit best-effort fallback to process stderr and continue returning the original error path

### 4.4 High-throughput SSE strategy

Log streams can produce very high event rates. SSE must batch and apply backpressure controls:

- batch new rows by logger ULID before broadcasting
- flush a batch on either threshold:
  - `SSE_BATCH_MAX_EVENTS` (default `200`)
  - `SSE_BATCH_MAX_MS` (default `250ms`)
- keep an in-memory replay ring buffer per logger stream (`SSE_REPLAY_BUFFER_BATCHES`, default `200`)
- preserve chronological order by `logged_at` within each emitted batch
- use periodic keep-alive comments (every ~25s) for proxy stability

Clarification:
- SSE batching is server -> browser live-tail delivery only.
- It does **not** control SDK -> Loggers ingest request frequency.

Backpressure/coalescing:
- if producer rate exceeds consumer capacity, coalesce multiple internal batches into fewer outbound frames
- if replay window is exceeded, emit a `resync` event and require client refetch from `/logger/:ulid/logs` using current filters

---

## 5. Billing (pues billing tabs)

All billing is via **pues `billing` tabs**.

### 5.1 Charges

- **Logger creation**: 2 credits
- **Ingest write** (`POST /logger/:ulid/ingest`): 0.01 credits per accepted line
- **Batch ingest**: `0.01 * accepted_count`
- **Reads/query/tail**: free

### 5.2 Tabs

- tab key: `ingest_write`
- threshold: 2 credits (settle when threshold reached)
- description: `"loggers.dev writes"`

### 5.3 Failures

- `402 payment_required` when account is not linked for hosted billing
- `429 charge_failed` when tab settlement/charge fails

### 5.4 Self-hosted mode

When hosted billing credentials are absent, billing is disabled (no charges), but write limits should still be enforced for safety.

---

## 6. API (REST + SSE)

### 6.1 Auth and app routes

- pues auth-mounted login/logout/callback routes
- `GET /` dashboard (PWA shell)
- `GET /:slug` logger detail (PWA shell)

### 6.2 Logger management (authenticated)

- `GET /api/loggers` — list user loggers
- `POST /api/loggers` — create logger (`name`)
- `PATCH /api/loggers/reorder` — reorder logger rows (`{ order: [slug, ...] }`)
- `PATCH /api/loggers/:slug` — rename logger
- `DELETE /api/loggers/:slug` — delete logger + its per-logger DB

### 6.3 Ingestion (ULID-scoped)

- `POST /logger/:ulid/ingest` — ingest one line
- `POST /logger/:ulid/batch` — ingest many lines (max N, default 500)

Auth model for these routes:
- no bearer token and no API key required
- possession of the ULID URL is the credential (single-logger scope)
- unknown ULID returns `404 not_found` (reason: `ulid`)

Payload line shape:

```json
{
  "level": "info",
  "component": "api",
  "data": { "msg": "request complete", "status": 200, "path": "/auth/login" },
  "logged_at": 1710000000123
}
```

Server writes `data` as received and computes `meta`.

### 6.4 Query/read

- `GET /logger/:ulid/logs` — chronological logs with preset date window + level/component + paging cursor
- `GET /logger/:ulid/search?q=...` — FTS5 query over `component + data_text + meta_text`
- `GET /logger/:ulid/events` — SSE tail stream

`GET /logger/:ulid/logs` filter params (v1):
- `window=today|yesterday|last_7_days` (date presets used by UI)
- optional `level`, `component`
- paging: `limit` (default `100`, max `100`) + `cursor`
- sort order: chronological by `logged_at` (oldest -> newest) within the selected window/filter
- cursor semantics: keyset pagination by `(logged_at, id)`; response returns `next_cursor` when more rows exist

Notes:
- Loggers uses `/logger/:ulid` routes (not `/fifo/:ulid`).
- UI default window is `today`.
- For web UI, presets are resolved in the viewer's local timezone, then translated to epoch bounds for query.

### 6.5 SSE stream semantics (`GET /logger/:ulid/events`)

Event types:

- `logs_batch` — batch of newly ingested rows for the logger
- `resync` — client should refetch current view via `/logger/:ulid/logs`

`logs_batch` payload (shape):

```json
{
  "items": [
    {
      "id": 123,
      "logged_at": 1710000000123,
      "level": "info",
      "component": "api",
      "data": {},
      "meta": {}
    }
  ],
  "count": 1,
  "from_logged_at": 1710000000123,
  "to_logged_at": 1710000000123
}
```

Delivery behavior:
- batches are emitted using the thresholds in §4.4
- supports `Last-Event-ID` replay for recent buffered events
- if requested replay id is outside buffer, server emits `resync`
- designed for high-volume streams ("shed-load" of events) without flooding clients per row

### 6.6 Public SDK download

- `GET /loggers.js` — public SDK file download (no auth)
- stable URL: `https://loggers.dev/loggers.js`
- cache policy should allow fast CDN/browser delivery while keeping versioning safe (ETag + long max-age with content hash path as future option)

---

## 7. SDK (`loggers.js`)

Provide a lightweight client SDK file, **`loggers.js`**, for app and service code.

Core API shape:

- `createLogger({ name?, ulid?, component, level?, flushIntervalMs?, batchSize? })`
- `logger.debug(data)`, `logger.info(data)`, `logger.warn(data)`, `logger.error(data)`
- `logger.flush()` and `logger.close()`

SDK rules:

- `component` required (may be set per instance, override allowed per call)
- `name` resolves to ULID via `loggers.yaml` (filesystem runtimes) so code can stay ULID-free
- direct `ulid` is still allowed and takes precedence when both are provided
- `level` is an optional minimum client-side emit level (`debug|info|warn|error`)
- log entries below the effective level are **silently dropped** client-side (not sent to server)
- SDK sets `logged_at` at call time on the client for every log entry
- SDK batches entries and sends via `POST /logger/:ulid/batch`
- default `flushIntervalMs` is `20000` (flush every 20 seconds)
- SDK auto-flush interval floor is `10000` (10 seconds) in normal operation
- default `batchSize` is `500` (aligned to server batch limit)
- retries with jittered backoff on transient network failures
- bounded in-memory queue with drop policy + callback hook
- no client-auth secrets beyond ingest URL
- in filesystem runtimes, SDK can also write local daily log files under `loggers/<name>/YYYY-MM-DD.log`

Batch/flush behavior:
- flush triggers: interval timer, explicit `logger.flush()`, and `logger.close()`
- SDK should not auto-flush more frequently than every 10 seconds in normal mode
- safety exception: flush early only to prevent queue overflow/backpressure failure
- `logger.close()` performs a final best-effort flush before shutdown
- each request must respect server batch limits (`LOGGERS_MAX_BATCH`, default 500)
- `batchSize` controls max entries per HTTP request when flushing (flushes may split into multiple requests if queue > `batchSize`)

`loggers.yaml` format (v1):

```yaml
timezone: UTC
default_level: info
loggers:
  todos_api:
    ulid: 01JABCDEF0123456789ABCDEF0
    level: debug
    file_retention_days: 7
  todos_auth:
    ulid: 01JABCDEF0123456789ABCDEFA
    level: warn
    file_retention_days: 0
```

Resolution:
- default path: `./loggers.yaml` (project root)
- optional override: `LOGGERS_CONFIG_PATH`
- if `name` cannot be resolved, SDK throws a clear configuration error
- level precedence: `createLogger.level` -> `loggers.<name>.level` -> `default_level` -> `info`
- timezone default: `UTC` when omitted

Local file logging (`file_retention_days`):
- one simple per-logger option in `loggers.yaml`: `file_retention_days`
- default is `7` when omitted
- `0` means disabled (no local file logging for that logger)
- when enabled, SDK writes to `loggers/<name>/YYYY-MM-DD.log`
- SDK removes local files older than `file_retention_days`

Timezone behavior:
- `timezone` is a top-level `loggers.yaml` option (IANA name, e.g. `UTC`, `America/Chicago`)
- it controls how unix epoch times are rendered to human-readable timestamps in local log files
- it also controls day boundaries for file naming/rotation (`YYYY-MM-DD.log`)
- `logged_at` remains unix epoch milliseconds and is not transformed

Level filtering behavior:
- filtering happens in the SDK before enqueue/network send
- below-threshold entries are dropped silently (no warning/no error)
- this is intentional in v1 to avoid noisy debug traffic by default

Distribution:
- publicly downloadable at `https://loggers.dev/loggers.js` (no login required)
- also served from the same route in self-hosted deployments (`GET /loggers.js`)
- copy/paste and ESM import usage snippets shown on each logger detail screen
- include one-click copy links for browser `<script>` and ESM `import` forms

### 7.1 CLI (`loggers`)

Provide a small `loggers` CLI focused on local log-file querying.

Scope (v1):
- query/read-only workflows over local files written by SDK
- uses `loggers.yaml` for logger-name resolution and timezone formatting
- does not replace SDK ingestion path (SDK remains primary writer)

Core commands (v1):
- `loggers list` — list configured logger names from `loggers.yaml`
- `loggers tail <name>` — follow `loggers/<name>/YYYY-MM-DD.log`
- `loggers grep <name> <query>` — text search across local daily files
- `loggers show <name> --since 24h --level warn` — filter by time and level
- `loggers stats <name> --since 24h` — counts by `D I W E`

Defaults:
- reads from `./loggers` local directory (same sink path used by SDK)
- respects `timezone` from `loggers.yaml` (default `UTC`)

---

## 8. Security and privacy

- Ingest endpoints are scoped by unguessable ULID URLs (same security model as `fifos` public API URLs).
- No ingest API keys in v1; URL secrecy is the access boundary for write routes.
- Hosted mode still enforces ownership for dashboard/manage routes.
- Log payloads may contain sensitive data; v1 stores plaintext in SQLite (no at-rest encryption by default).
- Add redaction processors in post-processing for known sensitive keys (`password`, `token`, etc.) into `meta.redactions`.

---

## 9. Configuration

Environment:

- `PORT` (default `3000`)
- `HOST` (default `0.0.0.0`)
- `PUES_DOMAIN` (public base URL)
- `PUES_DB_PATH` (control DB path, default `data/loggers.db`)
- `PUES_COOKIE_SECRET` (required in hosted mode)
- `LOGGERS_DB_DIR` (per-logger DB directory, default `data/loggers`)
- `LOGGERS_MAX_BATCH` (default `500`)
- `LOGGERS_MAX_OPEN_DBS` (default `32`)
- `LOGGERS_DB_IDLE_MS` (default `60000`)

Not used in v1:
- `LOGGERS_API_KEY` (intentionally omitted; ingestion is ULID-scoped)

Client SDK config:
- `LOGGERS_CONFIG_PATH` (optional path to `loggers.yaml`; default `./loggers.yaml`)

Path distinction:
- server customer/event databases live under `data/loggers/<ulid>.db`
- client local file sink (when enabled) writes `./loggers/<name>/YYYY-MM-DD.log`

`config/pues.yaml` should include pues parts:
- `core`, `theme`, `style`, `auth`, `billing`, `db`, `objects`, `sse`, `pwa`

---

## 10. App UX

- Mobile-first PWA, same ecosystem style as sibling apps.
- Header logo uses the existing **page-with-curl** mark (`📃`).
- Dashboard: logger list, create button, and right-side per-level counts per row.
- Count display follows `fifos` style compact right-side pill: `D I W E`.
- Counters are color-coded by level (same behavior/style family as `fifos`).
- Logger rows support drag/drop reorder (same interaction model as `fifos`), persisted via `PATCH /api/loggers/reorder`.
- Logger detail: level chips, preset date-window controls (`Today`, `Yesterday`, `Last 7 days`), component filter, search box, live tail, JSON drawer for `data` and derived `meta`.
- Date-window controls live in the header action area to the right of logger name (same placement pattern as undo/redo in `../todos`).
- Implementation note: mirror `../todos` `ObjectDetail` header-actions pattern (`TodoList` `actions` block / `.header-doc-history` region) so controls stay right-aligned and separate from title/subtitle text.
- Long log rows are truncated in the list and open in a click-to-expand dialog (same interaction pattern as `fifos` detail row expansion).
- Logger detail includes a prominent public **Download SDK** link/button to `https://loggers.dev/loggers.js`.

---

## 11. Out of scope for v1

- Redis/Kafka ingestion pipeline
- cross-logger federated search
- alerting/notification rules
- long-term archival tiers
- role-based multi-user sharing inside one logger

---

## 12. Future developments

- Optional Redis write buffer for burst-heavy traffic.
- Retention policies per logger (7d/30d/90d/custom).
- Saved queries and alert rules (`error spike`, `component outage`).
- Cross-service correlation (trace/span linking in `meta`).

---

## Checklist (implementation)

- [ ] Add `docs/SPEC.md` and align with architecture decisions.
- [ ] Update `config/pues.yaml` to include `auth` + `billing` (+ required pues deps).
- [ ] Implement control DB schema (`users`, `loggers`) and per-logger schema (`logger` + FTS).
- [ ] Implement logger ordering (`position`) plus drag/drop UI and reorder endpoint.
- [ ] Add required `component` field validation in ingest API and SDK.
- [ ] Implement and serve public `loggers.js` (`GET /loggers.js`) with stable download URL and usage docs in UI.
- [ ] Add `loggers.yaml` support in SDK (name->ULID mapping, timezone, default level, per-name level overrides, `file_retention_days`, default path + override env var).
- [ ] Implement post-processing pipeline that derives `meta` from `data`.
- [ ] Implement pues billing tab charges on ingest writes.
- [ ] Build logger management API + PWA screens.
- [ ] Build ingestion/query/search/SSE endpoints.
- [ ] Implement Pues-first architecture parity with `fifos` (prefer pues modules before bespoke infra).
- [ ] Implement logger-detail preset date-window filtering UI (`Today`, `Yesterday`, `Last 7 days`) in header-right controls and matching `/logger/:ulid/logs` params.
- [ ] Implement logs paging (`limit`, `cursor`) with default/max `100` and chronological ordering by `logged_at`.
- [ ] Implement truncated list rows with click-to-expand log dialog.
- [ ] Implement SSE batched delivery + replay + `resync` backpressure behavior for high-volume streams.
- [ ] Add logger-detail integration snippets for browser and server use of `loggers.js`.
- [ ] Implement `loggers` CLI for local log-file querying (`list`, `tail`, `grep`, `show`, `stats`).
- [ ] Implement internal dogfood failure sink to control DB `logger` table with recursion guard.
