# Loggers — Product Spec

A minimal PWA + SDK + CLI: **create loggers → ingest structured log lines → query/tail logs by level, component, and search text**. Hosted at **loggers.dev**. Designed for both humans and agents.

Built on the **pues framework**:

- **pues `auth`** — login/session/Legendum-linked identity
- **pues `billing`** — usage charges (per-write tab) on log ingestion
- **pues `objects`** — CRUD + reorder for the `loggers` registry
- **pues `sse`** — per-user dashboard live updates
- **pues `pwa`** — manifest + service worker
- **pues `core`/`theme`/`style`/`db`** — shell, theming, SQLite plumbing

Implementation baseline:

- Use **`../fifos` as the main implementation template** (routing style, UI patterns, ergonomics, SSE approach, pues integration style).
- Lean into **Pues-first** as much as fifos: prefer vendored pues parts over bespoke infra; only diverge where Loggers has hard product requirements.
- Explicit Loggers-specific divergences:
  - **database separation** (control DB + per-logger DB files)
  - **FTS5 search** (per-logger virtual table + triggers)
  - **high-volume SSE batching** (server → browser fan-out is coalesced)

First-client migration reference: for adopting Loggers in `../chats2me`, see `docs/CHATS2ME_MIGRATION.md`.

---

## 1. What it does

- **User signs in** via pues auth (Legendum-linked in hosted mode).
- **User creates loggers** — each is a named stream with a unique ingest ULID.
- **Clients send logs** through `loggers.js` (SDK) or direct HTTP.
- **Each log line carries `level`, `component`, `data`, `logged_at`.**
  - `component` is a required discriminator for sub-system source (`auth`, `api`, `worker`, `cron`, …).
  - `data` is client-supplied JSON payload (what the caller observed).
  - `meta` is server-derived enrichment (what Loggers infers after post-processing).
- **Users filter, FTS-search, and live-tail** in the web UI and via REST.
- **Dashboard rows show a compact `D I W E` count pill** — color-coded per level (same scanning idiom as fifos).

---

## 2. User flows

### 2.1 Auth (pues auth)

1. User opens `loggers.dev` and signs in through pues auth.
2. Backend uses pues auth middleware for login/callback, session cookie, and logout.
3. Hosted mode uses Legendum-linked identity and billing eligibility.
4. Self-hosted mode works without Legendum billing — limits in §3.4 still apply (see §8).

### 2.2 Loggers

1. After login, the user lands on a dashboard listing their loggers (ordered by `position` ASC, then `id` ASC).
2. **Create logger** with `{ label }`. Server derives `slug` from `label`, mints a global `ulid`, and assigns `position = MAX(position)+1` for the user. A per-logger DB file is provisioned on success at `data/loggers/<ulid>.db`.
3. Logger detail screen shows:
   - ingest URL (`/logger/:ulid/ingest`)
   - SDK snippet (browser `<script>` + ESM `import`)
   - recent logs, filters, FTS search box, and live tail
4. **Drag-to-reorder** on the dashboard (same interaction model as fifos), persisted via `PATCH /api/loggers/:ulid` with `{ before | after }` anchor ULID (the pues `objects` reorder shape).

Browser URLs use `loggers.dev/<slug>` for SPA routing only; management REST uses ULIDs.

### 2.3 Log ingestion

Clients can write logs in two ways:

- **SDK (primary)** — `loggers.js` for app and service code.
- **HTTP (fallback)** — direct `POST /logger/:ulid/ingest` (one line) or `POST /logger/:ulid/batch` (many).

Access model (v1):

- Ingest is authorized by ULID-in-URL — same model as fifos public API URLs.
- **No bearer token, no API key.** Possession of the ULID is the credential.
- No `LOGGERS_API_KEY` requirement in SDK or environment.
- Unknown ULID → `404 not_found` with `reason: ulid`.

Each ingested line includes:

| Field | Type | Notes |
|---|---|---|
| `level` | `debug` \| `info` \| `warn` \| `error` | Closed enum in v1; unknown → `400 invalid_request`. |
| `component` | TEXT | Required discriminator for sub-system source. |
| `data` | JSON object | Caller-supplied payload, written verbatim. |
| `logged_at` | INTEGER (unix epoch ms) | **Client-set** event time, canonical for ordering/filtering. |

Timestamp policy (v1):

- `logged_at` is the canonical event time for ordering/filtering in UI and API.
- `logged_at` must be produced client-side (SDK sets it at log-call time); the server does not assign it.
- Server additionally stores `created_at` (receipt time, unix seconds) for observability/debugging.

### 2.4 Post-processing (`data` → `meta`)

After ingest, Loggers runs post-processing to derive server-side `meta`:

- normalize and validate shape
- extract canonical fields (request IDs, actor IDs, route names)
- classify and error-tag lines
- add indexing hints and searchable text fragments
- redact known sensitive keys (`password`, `token`, …) into `meta.redactions` (see §9)

`meta` is owned by the platform and may evolve without SDK API breaks.

### 2.5 Search and tail

- Filter by level, component, and date-window presets (`Today`, `Yesterday`, `Last 7 days`).
- Full-text search over normalized log text via SQLite FTS5 (see §3.3).
- Live tail via SSE on logger detail (`GET /logger/:ulid/events`).
- SSE delivery is **batched** (not one-message-per-line) — see §5.3.
- Log list ordering is chronological by `logged_at` (oldest → newest within the window).

### 2.6 Reordering

- Loggers can be dragged up/down on the dashboard. Drag-end commits a single move via `PATCH /api/loggers/:ulid` with `{ before | after }` (pues `objects` convention).
- Log rows are **not** reorderable — chronological-by-`logged_at` is fixed.

---

## 3. Data we store

**Hierarchy:** users → loggers → (per-logger DB) logs.

There is **one control DB** plus **one per-logger event DB** per logger ULID:

- control: `data/loggers.db`
- per-logger: `data/loggers/<ulid>.db` (one SQLite file per logger; no nested subfolders in v1)

### 3.1 Control DB tables (`data/loggers.db`)

- **users**: `id` (PK), `email` (UNIQUE NOT NULL), `legendum_token`, `meta` (TEXT default `{}`), `created_at`. Identical shape to fifos/todos.
- **loggers**: `id` (PK auto-increment), `user_id` (FK → users, `ON DELETE CASCADE`), `ulid` (TEXT UNIQUE — public ingest credential, Crockford base32, 26 chars), `name` (TEXT, display name as typed), `slug` (TEXT, URL-safe form, **unique per user**), `position` (INTEGER, user-defined ordering on the dashboard; new loggers get `MAX(position)+1`), `created_at`, `updated_at`. **Listed by `position` ASC, then `id` ASC.**
- **logger** (singular — internal **dogfood failure sink** for Loggers service failures, **not** tenant data): `id` (PK auto-increment), `logged_at` (INTEGER unix ms, event time), `created_at` (INTEGER unix s, receipt time), `updated_at` (INTEGER unix s), `level` (`debug` \| `info` \| `warn` \| `error`, default `error`), `component` (TEXT — usually `loggers` or `loggers.<subsystem>`), `data` (TEXT JSON — failure payload: operation, target ulid, error class/message, request metadata), `meta` (TEXT JSON — derived tags for later filtering/search).

Indexes:

```sql
CREATE INDEX        idx_loggers_user_id     ON loggers(user_id);
CREATE INDEX        idx_loggers_position    ON loggers(user_id, position);
CREATE UNIQUE INDEX idx_loggers_user_slug   ON loggers(user_id, slug);
```

`PRAGMA foreign_keys = ON` must be issued on every connection — SQLite has FK enforcement off by default, so without it the `ON DELETE CASCADE` clauses silently no-op.

### 3.2 Per-logger DB (`data/loggers/<ulid>.db`)

One SQLite file per logger ULID, opened on demand via the connection cache (§5.1). Schema applied on provision/open from `config/schema-logger.sql`.

Table: **`logger`** — `id` (PK auto-increment), `logged_at` (INTEGER unix ms, **client event time, canonical for ordering**), `created_at` (INTEGER unix s, server receipt time), `updated_at` (INTEGER unix s), `level` (`debug` \| `info` \| `warn` \| `error` — CHECK constraint), `component` (TEXT NOT NULL, sub-system discriminator), `data` (TEXT NOT NULL, JSON from client SDK/caller), `meta` (TEXT NOT NULL, JSON derived by server post-processing).

Indexes (event-time oriented):

```sql
CREATE INDEX idx_logger_logged_at            ON logger(logged_at);
CREATE INDEX idx_logger_level_logged_at      ON logger(level, logged_at);
CREATE INDEX idx_logger_component_logged_at  ON logger(component, logged_at);
```

SQLite remains in **WAL mode** for concurrency (`PRAGMA journal_mode = WAL` on open).

### 3.3 FTS5 (per-logger DB)

Following the proven `wikis` pattern, each per-logger DB includes a contentless-mirror FTS5 virtual table and triggers to keep it in sync:

```sql
CREATE VIRTUAL TABLE logger_fts USING fts5(
  component,
  data_text,
  meta_text,
  content=logger,
  content_rowid=id,
  tokenize='porter unicode61'
);

CREATE TRIGGER logger_ai AFTER INSERT ON logger BEGIN
  INSERT INTO logger_fts(rowid, component, data_text, meta_text)
  VALUES (new.id, new.component, new.data, new.meta);
END;
-- (matching logger_ad / logger_au for DELETE / UPDATE)
```

`data_text` and `meta_text` are normalized text projections derived from JSON during post-processing — flattened keys/values made searchable without exposing raw JSON syntax to the tokenizer.

### 3.4 Limits

- **Max line `data` size**: 64 KB.
- **Max batch size**: `LOGGERS_MAX_BATCH` (default `500`).
- **Max open per-logger DB handles**: `LOGGERS_MAX_OPEN_DBS` (default `32`) — LRU eviction beyond this.
- **Connection idle close**: `LOGGERS_DB_IDLE_MS` (default `60000`).
- **Max loggers per user**: enforced on `POST /api/loggers` (default cap to be set with first deployment; align with `FIFOS_MAX_FIFOS_PER_USER = 50` unless product requirements diverge).
- **Per-logger retention**: not enforced in v1 — see §13.

---

## 4. Tech stack & project structure

Same stack as fifos/todos: **Bun for everything**, **TypeScript**, **Bun.serve**, **bun:sqlite**, **React 18 + custom CSS** frontend, **workbox-build** for the PWA, **Biome** for lint. Domain: **loggers.dev**.

### Project structure

```
src/
  api/
    server.ts
    handlers/
      auth.ts
      loggers.ts          # pues mountResource("loggers")
      ingest.ts           # /logger/:ulid/{ingest,batch}
      query.ts            # /logger/:ulid/{logs,search,events}
      sdk.ts              # GET /loggers.js
  web/
    App.tsx
    entry.tsx
    manifest.json
    main.css
    components/
  cli/
    main.ts               # `loggers` CLI (local file querying)
  lib/
    constants.ts          # server + re-exports web_constants
    web_constants.ts      # browser-safe literals
    db.ts                 # control DB open/migrate
    loggerDb.ts           # per-logger DB open/provision + LRU cache
    postprocess.ts        # data → meta enrichment + redaction
    sse.ts                # batched fan-out + ring buffer + Last-Event-ID
    dogfood.ts            # write failures to control-DB `logger` table
    billing.ts            # pues billing tab wrapper
    ulid.ts
public/
  loggers.js              # served at GET /loggers.js
  loggers-192.png         # PWA icon
  loggers-512.png         # PWA icon (also maskable)
config/
  pues.yaml
  schema.sql              # control DB
  schema-logger.sql       # per-logger DB (applied on provision)
  SKILL.md                # agent skill (if/when added)
tests/
  *.test.ts
scripts/
  build.ts
docs/
  CONCEPT.md
  SPEC.md
  PLAN.md
  CHATS2ME_MIGRATION.md
package.json              # bin: { "loggers": "src/cli/main.ts" }
biome.json
tsconfig.json
```

---

## 5. Infrastructure

### 5.1 Per-logger DB connection cache (LRU)

Do not keep all per-logger databases open indefinitely.

- max open handles: `LOGGERS_MAX_OPEN_DBS` (default `32`)
- idle timeout: `LOGGERS_DB_IDLE_MS` (default `60000`)
- LRU eviction beyond max; reopen on demand
- WAL mode on every connection

Implemented in `src/lib/loggerDb.ts`.

### 5.2 Internal failure logging (dogfood)

When Loggers fails to ingest/write/query through the normal per-logger flow, it records that failure in the well-known control-DB sink table:

- target: `data/loggers.db` → table `logger`
- `data`: operation, ulid, error class/message, request metadata
- `meta`: derived tags for later filtering/search
- `level`: `error` by default (`warn` for recoverable/transient cases)

**Recursion guard**: if writing to the control DB `logger` table itself fails, do **not** recurse into another Loggers write attempt. Emit a best-effort line to `process.stderr` and continue returning the original error path.

### 5.3 High-throughput SSE batching

Log streams can produce very high event rates. SSE must batch and apply backpressure controls:

- batch new rows per logger ULID before broadcasting
- flush a batch on either threshold:
  - `SSE_BATCH_MAX_EVENTS` (default `200`)
  - `SSE_BATCH_MAX_MS` (default `250`)
- preserve chronological order by `logged_at` within each emitted batch
- per-stream in-memory replay ring buffer of recent batches: `SSE_REPLAY_BUFFER_BATCHES` (default `200`)
- periodic keep-alive comment (`: keep-alive\n\n`) every ~25s for proxy stability
- on producer-over-consumer pressure, coalesce multiple internal batches into fewer outbound frames
- if `Last-Event-ID` falls outside the replay window, emit a `resync` event — client refetches from `/logger/:ulid/logs` with current filters

Clarification: SSE batching is **server → browser live-tail delivery only**. It does **not** control SDK → Loggers ingest request frequency (which is controlled by SDK `flushIntervalMs` / `batchSize`, see §7).

### 5.4 Redis buffering

**v1: no Redis required.** Direct SQLite writes, optional small in-process batch flush. Add Redis later only if production write throughput requires external buffering.

---

## 6. API (REST + SSE)

### 6.1 Auth & app routes

- pues auth-mounted login/callback/logout
- `GET /` — dashboard (PWA shell)
- `GET /:slug` — logger detail (PWA shell)
- `GET /pues/me` — pues `base/auth/mountUserSettings` (`{ legendum_linked, hosted, meta }`); `PATCH` merges `meta`

### 6.2 Logger management (authenticated)

Mounted via `mountResource("loggers")` from pues `objects` — same pattern as fifos (`/api/fifos/:id` where `:id` is the ULID).

| Route | Description |
|---|---|
| `GET /api/loggers` | List user loggers. Wire shape per row: `{ id, ulid, label, slug, position, created_at, updated_at }` plus a `counts: { debug, info, warn, error }` block for the dashboard pill. |
| `POST /api/loggers` | Create logger. Body: `{ label }`. Server derives slug, mints ulid, assigns `position = MAX(position)+1`, provisions per-logger DB. Returns the full row. **2 credits.** |
| `PATCH /api/loggers/:ulid` | Update label (re-derives `slug`) **or** reorder via `{ before | after }` anchor ULID. Pues `objects` convention. |
| `DELETE /api/loggers/:ulid` | Delete logger and its per-logger DB file. |
| `GET /api/loggers/level-counts` | Flat `{ parent_id, value, n }[]` for D/I/W/E pills (fifos `useCounts` shape). |
| `GET /api/events` | pues per-user SSE stream — `loggers.*` row events (dashboard live updates). |

Browser URLs use `loggers.dev/<slug>` for SPA routing; management REST uses ULIDs.

### 6.3 Ingestion (ULID-scoped, no auth)

| Route | Body | Returns | Cost |
|---|---|---|---|
| `POST /logger/:ulid/ingest` | one line (JSON, shape below) | `201 { id, logged_at }` | **0.001** |
| `POST /logger/:ulid/batch` | `{ lines: [...] }` (max `LOGGERS_MAX_BATCH`, default 500) | `201 { accepted, rejected: [{ index, reason }] }` | **0.001 × accepted** |

Auth: ULID-in-URL only (no bearer, no API key). Unknown ULID → `404 not_found` with `reason: ulid`.

Payload line shape:

```json
{
  "level": "info",
  "component": "api",
  "data": { "msg": "request complete", "status": 200, "path": "/auth/login" },
  "logged_at": 1710000000123
}
```

Server stores `data` verbatim and computes `meta` (§2.4).

### 6.4 Query/read (authenticated)

| Route | Description |
|---|---|
| `GET /logger/:ulid/logs` | Chronological logs with preset date window + level/component filters + paging cursor. |
| `GET /logger/:ulid/search?q=...` | FTS5 query over `component + data_text + meta_text`. |
| `GET /logger/:ulid/events` | SSE tail stream — see §6.5. |

`GET /logger/:ulid/logs` params (v1):

- `window` = `today` \| `yesterday` \| `last_7_days` (default `today`; UI default)
- optional `level`, `component`
- `limit` (default `100`, max `100`)
- `cursor` — keyset pagination by `(logged_at, id)`; response includes `next_cursor` when more rows exist
- sort order: chronological by `logged_at` (oldest → newest) within the window

For the web UI, presets are resolved in the **viewer's local timezone**, then translated to epoch bounds for the query.

### 6.5 SSE stream semantics (`GET /logger/:ulid/events`)

Event types:

- `logs_batch` — batch of newly ingested rows for the logger
- `resync` — client should refetch current view via `/logger/:ulid/logs`

`logs_batch` payload:

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

- batches are emitted per the thresholds in §5.3
- supports `Last-Event-ID` replay from the per-stream ring buffer
- if requested replay id is outside the buffer, server emits `resync`
- designed for high-volume streams without flooding clients per row

### 6.6 Public SDK download

| Route | Description |
|---|---|
| `GET /loggers.js` | Plain-text SDK file. **No auth.** Stable URL `https://loggers.dev/loggers.js`. ETag + long `max-age`; consider content-hashed paths for hard cache later. |

The web UI logger-detail screen surfaces one-click copy snippets for browser `<script>` and ESM `import` usage.

### 6.7 Errors

Same shape as fifos/todos: `{ "error": "<code>", "reason": "<detail>" }` for 4xx.

| Status | error | reason | When |
|---|---|---|---|
| 400 | `invalid_request` | (free text) | Unknown level, body too large, malformed JSON, `component` missing, etc. |
| 402 | `payment_required` | — | No Legendum account linked, hosted mode. |
| 404 | `not_found` | `ulid` | Unknown ingest ULID. |
| 404 | `not_found` | `logger` | Unknown slug on `/:slug`. |
| 429 | `charge_failed` | — | Pues billing tab settle failed. |

---

## 7. SDK (`loggers.js`)

Lightweight client SDK file, **`loggers.js`**, for app and service code. Public download at `https://loggers.dev/loggers.js` (also self-hosted at `GET /loggers.js`).

Core API shape:

```ts
createLogger({
  name?,            // resolved via loggers.yaml when filesystem available
  ulid?,            // takes precedence when both supplied
  component,        // REQUIRED — sub-system discriminator
  level?,           // minimum client-side emit level
  flushIntervalMs?, // default 20000; floor 10000
  batchSize?,       // default 500; aligned to LOGGERS_MAX_BATCH
})

logger.debug(data)
logger.info(data)
logger.warn(data)
logger.error(data)
logger.flush()
logger.close()
```

SDK rules:

- `component` required (per-instance default, override allowed per call)
- `name` resolves to ULID via `loggers.yaml` (filesystem runtimes) so source code can stay ULID-free
- `ulid` is still allowed and takes precedence when both supplied
- `level` is an optional minimum client-side emit level (`debug` \| `info` \| `warn` \| `error`)
- below-threshold entries are **dropped silently client-side** (no warning, no error, no network)
- SDK sets `logged_at` at call time on the client for every entry
- SDK batches entries and sends via `POST /logger/:ulid/batch`
- default `flushIntervalMs = 20000`; **floor is 10000** in normal operation
- default `batchSize = 500` (matches `LOGGERS_MAX_BATCH`); flushes may split into multiple requests when queue > `batchSize`
- retries with jittered backoff on transient network failures
- bounded in-memory queue with drop policy + callback hook
- no client-auth secrets beyond the ingest URL
- filesystem runtimes may also write local daily files under `loggers/<name>/YYYY-MM-DD.log`

Batch/flush behavior:

- flush triggers: interval timer, explicit `logger.flush()`, `logger.close()`
- safety exception: flush early to prevent queue overflow/backpressure failure
- `logger.close()` performs a final best-effort flush before shutdown

`loggers.yaml` (v1):

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
- override: `LOGGERS_CONFIG_PATH`
- unresolved `name` → SDK throws a clear configuration error
- level precedence: `createLogger.level` → `loggers.<name>.level` → `default_level` → `info`
- `timezone` defaults to `UTC` when omitted

Local file logging:

- per-logger option `file_retention_days` (default `7`; `0` disables local file logging)
- when enabled, SDK writes `loggers/<name>/YYYY-MM-DD.log`
- SDK removes local files older than `file_retention_days`
- `timezone` controls human-readable rendering and day-boundary rotation (`YYYY-MM-DD.log`); `logged_at` itself stays unix ms

Distribution:

- public download at `https://loggers.dev/loggers.js` (no login)
- copy/paste and ESM import snippets shown on each logger detail screen
- one-click copy links for browser `<script>` and ESM `import` forms

### 7.1 CLI (`loggers`)

Small `loggers` CLI focused on **local log-file querying** (read-only over files the SDK wrote). It does **not** replace SDK ingestion.

| Command | Behavior |
|---|---|
| `loggers list` | List configured logger names from `loggers.yaml`. |
| `loggers tail <name>` | Follow `loggers/<name>/YYYY-MM-DD.log`. |
| `loggers grep <name> <query>` | Text search across local daily files. |
| `loggers show <name> --since 24h --level warn` | Filter by time and level. |
| `loggers stats <name> --since 24h` | Counts by `D I W E`. |
| `loggers help` / `--help` | Show commands. |

Defaults:

- reads from `./loggers` local directory (same sink path the SDK writes to)
- respects `timezone` from `loggers.yaml` (default `UTC`)

---

## 8. Billing (pues billing tabs)

All billing via **pues `billing` tabs**.

| Action | Cost |
|---|---|
| Logger creation (`POST /api/loggers`) | 2 credits |
| Ingest write (`POST /logger/:ulid/ingest`) | 0.001 credits / accepted line |
| Batch ingest | `0.001 × accepted_count` |
| Reads / query / search / tail | Free |
| Authenticated dashboard routes | Free |

Tabs:

- key: `ingest_write`
- threshold: **2 credits** (settle when threshold reached)
- description: `"loggers.dev writes"`

Failures:

- `402 payment_required` when account isn't linked for hosted billing
- `429 charge_failed` when tab settlement fails

Self-hosted mode (no hosted billing credentials) disables billing entirely; limits in §3.4 still apply.

---

## 9. Security & privacy

- Ingest endpoints are scoped by unguessable ULID URLs — same model as fifos public API URLs (128-bit ULID, 80-bit cryptographic random).
- **No ingest API keys in v1.** URL secrecy is the access boundary for write routes. A leaked ULID exposes only that single logger.
- Hosted mode still enforces ownership for dashboard / management routes.
- CORS open to `*` on the ingest routes.
- **HTTPS only in production.**
- Log payloads may contain sensitive data; v1 stores plaintext in SQLite (no at-rest encryption by default).
- Post-processing applies a redaction pass for known sensitive keys (`password`, `token`, …) into `meta.redactions`.

---

## 10. Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Bind host |
| `PUES_DOMAIN` | derived | Public base URL |
| `PUES_DB_PATH` | `data/loggers.db` | Control DB (pues `base/db`) |
| `PUES_COOKIE_SECRET` | — | Required in hosted mode (pues `base/auth`) |
| `LOGGERS_DB_DIR` | `data/loggers` | Per-logger DB directory |
| `LOGGERS_MAX_BATCH` | `500` | Max lines per batch ingest |
| `LOGGERS_MAX_OPEN_DBS` | `32` | Per-logger DB handle cap (LRU) |
| `LOGGERS_DB_IDLE_MS` | `60000` | Idle close for per-logger handles |
| `SSE_BATCH_MAX_EVENTS` | `200` | Server-side SSE batch trigger |
| `SSE_BATCH_MAX_MS` | `250` | Server-side SSE batch trigger |
| `SSE_REPLAY_BUFFER_BATCHES` | `200` | Per-stream replay ring buffer |

Not used in v1:

- `LOGGERS_API_KEY` — intentionally omitted; ingestion is ULID-scoped.

Client SDK config:

| Variable | Purpose |
|---|---|
| `LOGGERS_CONFIG_PATH` | Optional override for `./loggers.yaml`. |

Path distinction:

- server customer/event DBs: `data/loggers/<ulid>.db`
- client local file sink (when enabled): `./loggers/<name>/YYYY-MM-DD.log`

`config/pues.yaml` should include pues parts: `core`, `theme`, `style`, `auth`, `billing`, `db`, `objects`, `sse`, `pwa`.

---

## 11. App UX

Mobile-first PWA, portrait-optimized. Same shell as fifos / sibling apps.

### 11.1 Dashboard (home)

- **Top bar**: logo (page-with-curl `📃`), Legendum link/unlink widget (right).
- **Body**: list of loggers, ordered by `position` (drag-to-reorder). Each row shows name + `D I W E` count pill (color-coded by level, same family as fifos).
- **"+"** to create.
- **Drag-end** commits a single-move via `PATCH /api/loggers/:ulid` with `{ before | after }`.

### 11.2 Logger detail

- **Back arrow** → home.
- **Header**: logger name, ULID copy button, and a right-aligned actions area for date-window controls (`Today` / `Yesterday` / `Last 7 days`) — same placement pattern as undo/redo in `../todos` `ObjectDetail` (`.header-doc-history` region).
- **Filter chips**: level chips + component filter + search box (FTS5).
- **Body**: chronological log rows. Long rows truncated in the list and **click-to-expand** into a dialog (same interaction as fifos detail row expansion). JSON drawer shows `data` and derived `meta`.
- **Live tail** via SSE on `GET /logger/:ulid/events`.
- **Download SDK** — prominent public link/button to `https://loggers.dev/loggers.js`.

---

## 12. PWA & service worker

Provided by **pues `base/pwa/`** (vendored). `scripts/build-sw.ts` calls `buildPwa({ root, additionalAssets })` from `pues/base/pwa/server`, which generates `public/manifest.json` and `public/dist/sw.js` (workbox `generateSW` under the hood). The PWA manifest's name + icon slugs derive from `core.name` in `config/pues.yaml`; theme + background colors inherit from `style.dark` tokens. `src/web/entry.tsx` calls `registerServiceWorker()` from `pues/base/pwa` — page reloads on `controllerchange` are baked in. No FCM.

**Routes:** `mountPwaRoutes({ root })` in `server.ts` mounts `GET /manifest.json`, `GET /dist/sw.js`, `GET /loggers-192.png`, `GET /loggers-512.png`, plus workbox-* runtime chunks via a fall-through `pwa.fetch(req)` in the main handler. Icons live under `public/`.

---

## 13. Out of scope for v1

- Redis / Kafka ingestion pipeline
- Cross-logger federated search
- Alerting / notification rules (`error spike`, `component outage`)
- Long-term archival tiers and per-logger retention policies
- Role-based multi-user sharing within one logger
- Push notifications, native mobile apps, WebSockets
- Ingest API keys (URL-scoped ULID is the v1 credential)
- At-rest encryption

---

## 14. Future developments

- Optional **Redis write buffer** for burst-heavy traffic.
- **Per-logger retention policies** (7d / 30d / 90d / custom).
- **Saved queries and alert rules** (`error spike`, `component outage`).
- **Cross-service correlation** (trace/span linking inside `meta`).
- **Native MCP server** — thin wrapper exposing query/tail/search as MCP tools for direct integration in Claude Code, Cursor, etc.
- Per-logger **default level** server-side enforcement (drop below-threshold writes before persisting).

---

## Checklist (implementation)

- [ ] **Spec**: `docs/SPEC.md` aligned with architecture decisions.
- [ ] **Config**: `config/pues.yaml` includes `core`, `theme`, `style`, `auth`, `billing`, `db`, `objects`, `sse`, `pwa` (+ required deps).
- [ ] **DB — control**: `data/loggers.db` from `config/schema.sql` — `users`, `loggers`, `logger` (failure sink). Indexes per §3.1. `PRAGMA foreign_keys = ON` on every connection.
- [ ] **DB — per-logger**: `data/loggers/<ulid>.db` provisioned from `config/schema-logger.sql` (table + indexes + FTS5 + triggers). WAL mode on open.
- [ ] **DB — LRU cache**: `src/lib/loggerDb.ts` with `LOGGERS_MAX_OPEN_DBS` + `LOGGERS_DB_IDLE_MS`.
- [ ] **Auth**: pues auth routes + Legendum link/unlink widget.
- [ ] **Loggers API**: `mountResource("loggers")` — `GET / POST / PATCH ({label|before|after}) / DELETE` per §6.2; `position = MAX(position)+1` on create; reorder via `{ before | after }`; `GET /api/loggers/level-counts` flat shape.
- [ ] **Ingest API**: `POST /logger/:ulid/{ingest,batch}` per §6.3; ULID-only auth; closed level enum; required `component`; client-set `logged_at`.
- [ ] **Query API**: `GET /logger/:ulid/logs` (window presets, level/component filters, keyset cursor); `GET /logger/:ulid/search` (FTS5).
- [ ] **SSE**: `GET /logger/:ulid/events` with batched `logs_batch` + `resync`; `Last-Event-ID` replay; 25s keep-alives (§5.3 thresholds).
- [ ] **Post-processing**: `src/lib/postprocess.ts` — `data → meta` enrichment + sensitive-key redaction.
- [ ] **Dogfood sink**: `src/lib/dogfood.ts` writes failures to control-DB `logger`; recursion guard to stderr.
- [ ] **Billing**: pues tabs — 2 cr per logger create, 0.001 per accepted ingest line, 2-cr threshold; no billing in self-hosted.
- [ ] **SDK (`loggers.js`)**: `createLogger`/level methods/flush/close; `loggers.yaml` resolution (name → ulid, timezone, default level, per-name level, `file_retention_days`, env override); client-side level filtering; client-set `logged_at`; batching (`flushIntervalMs` 20000 with 10000 floor, `batchSize` 500); local daily files; jittered retries.
- [ ] **Public SDK route**: `GET /loggers.js` (no auth) + cache headers + UI copy snippets.
- [ ] **CLI**: `loggers list / tail / grep / show / stats / help` against local files.
- [ ] **Frontend — dashboard**: logger list with `D I W E` pill, create, drag-to-reorder via `PATCH /api/loggers/:ulid { before|after }`.
- [ ] **Frontend — detail**: level/component filters, FTS search box, header-right date-window controls (`Today`/`Yesterday`/`Last 7 days`), live tail, truncated rows with click-to-expand dialog, `Download SDK` button.
- [ ] **PWA**: `buildPwa()` from pues `base/pwa`; `registerServiceWorker()` in entry; `mountPwaRoutes()` in server; icons under `public/`.
- [ ] **Tests**: auth, loggers CRUD + reorder, ingest (single + batch), query (window/level/component + cursor), FTS search, SSE batching/replay/resync, dogfood sink + recursion guard, billing.
