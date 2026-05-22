# Loggers — Implementation Plan

Execution plan for building `loggers` in phased, check-offable steps.

Primary references:
- `docs/SPEC.md` (source of truth)
- `docs/CHATS2ME_MIGRATION.md` (first-client rollout)

---

## How To Use This Plan

- Work top-to-bottom by phase.
- Keep checkboxes current in git as progress log.
- If scope changes, update `SPEC.md` first, then this file.

---

## Phase 0 — Project Setup & Guardrails

**Goal:** repo is ready for iterative implementation.

- [ ] Confirm scripts (`dev`, `build`, `test`, `lint`, `smoke`) run cleanly.
- [ ] Add/update `docs/PLAN.md` (this file) and keep it as the live checklist.
- [ ] Ensure coding baseline is Pues-first (mirror `fifos` conventions).
- [ ] Create placeholder source tree (api/web/lib/cli) if missing.

**Done when:** `bun run lint` and `bun run test` are green on baseline project.

---

## Phase 1 — Pues Adoption Baseline

**Goal:** lean into Pues modules as much as `fifos`.

- [x] Update `config/pues.yaml` to include: `core`, `theme`, `style`, `auth`, `billing`, `db`, `objects`, `sse`, `pwa`.
- [x] Run vendoring flow (`bun run pues`) and verify imported parts compile.
- [ ] Wire Pues auth routes/middleware for hosted + self-hosted modes.
- [ ] Wire Pues billing tabs config for create/ingest charging.

**Done when:** app starts with Pues auth + billing plumbing enabled.

---

## Phase 2 — Data Layer & Schemas

**Goal:** DB layout and schema are implemented exactly as spec’d.

- [ ] Control DB at `data/loggers.db` with tables: `users`, `loggers`, internal `logger`.
- [ ] Per-logger DB hierarchy: `data/loggers/<ulid>.db`.
- [ ] Per-logger `logger` table includes `logged_at`, `level`, `component`, `data`, `meta`.
- [ ] Create indexes on `(logged_at)`, `(level, logged_at)`, `(component, logged_at)`.
- [ ] Enable WAL mode and FK behavior as needed.
- [ ] Add open-handle LRU/idle strategy (`LOGGERS_MAX_OPEN_DBS`, `LOGGERS_DB_IDLE_MS`).

**Done when:** creating a logger provisions a writable per-logger DB and schema.

---

## Phase 3 — Logger Management API + Dashboard Backbone

**Goal:** users can manage loggers and order them.

- [ ] Implement `GET /api/loggers`.
- [ ] Implement `POST /api/loggers` (name/slug/ulid creation + billing create charge).
- [ ] Implement `PATCH /api/loggers/:slug` (rename).
- [ ] Implement `DELETE /api/loggers/:slug` (delete + per-logger DB cleanup).
- [ ] Implement `PATCH /api/loggers/reorder` (`position` updates).
- [ ] Return right-side counts payload (`D I W E`) for dashboard rows.

**Done when:** dashboard CRUD + drag reorder work end-to-end.

---

## Phase 4 — Ingestion Pipeline (ULID-Scoped)

**Goal:** high-volume ingest works with spec constraints.

- [ ] Implement `POST /logger/:ulid/ingest`.
- [ ] Implement `POST /logger/:ulid/batch` (default/max batch handling).
- [ ] Enforce level validation (`debug|info|warn|error` only).
- [ ] Enforce required `component`, `data`, `logged_at`.
- [ ] Preserve client-provided `logged_at` as canonical event time.
- [ ] Run post-processing pipeline to derive `meta` from `data`.
- [ ] Apply Pues tab charges on accepted writes.
- [ ] Ensure unknown ULID -> `404 not_found` (`reason: ulid`).

**Done when:** SDK payloads write successfully and appear queryable by `logged_at`.

---

## Phase 5 — Query, Search, Paging

**Goal:** read APIs match UI behavior and scale expectations.

- [ ] Implement `GET /logger/:ulid/logs`.
- [ ] Support `window=today|yesterday|last_7_days`.
- [ ] Support optional `level`, `component`.
- [ ] Support keyset paging via `limit`/`cursor`, default/max `100`.
- [ ] Return `next_cursor` when more data exists.
- [ ] Guarantee chronological order by `logged_at` (oldest -> newest).
- [ ] Implement `GET /logger/:ulid/search?q=...` with FTS5.

**Done when:** UI/CLI can paginate and filter logs reliably without time-order regressions.

---

## Phase 6 — SSE Realtime (Batched)

**Goal:** realtime tail handles very high event volume safely.

- [ ] Implement `GET /logger/:ulid/events`.
- [ ] Emit `logs_batch` and `resync` events.
- [ ] Batch server->browser stream by:
  - [ ] `SSE_BATCH_MAX_EVENTS` (default `200`)
  - [ ] `SSE_BATCH_MAX_MS` (default `250ms`)
- [ ] Preserve chronological order within each batch.
- [ ] Add replay support (`Last-Event-ID`) with ring buffer.
- [ ] Emit `resync` when replay window is exceeded.
- [ ] Add keep-alive comments (~25s).

**Done when:** live tail stays responsive under burst load and reconnects safely.

---

## Phase 7 — SDK (`loggers.js`)

**Goal:** SDK is the primary ingestion interface.

- [ ] Serve SDK at `GET /loggers.js` (public, stable URL).
- [ ] Implement API:
  - [ ] `createLogger({ name?, ulid?, component, level?, flushIntervalMs?, batchSize? })`
  - [ ] `debug/info/warn/error`, `flush`, `close`
- [ ] Implement `loggers.yaml` resolution:
  - [ ] top-level `timezone` (default `UTC`)
  - [ ] top-level `default_level`
  - [ ] per-name `ulid`, `level`, `file_retention_days`
  - [ ] `LOGGERS_CONFIG_PATH` override
- [ ] Level filtering:
  - [ ] below-threshold events silently dropped
- [ ] Batching behavior:
  - [ ] default `flushIntervalMs=20000`
  - [ ] floor `flushIntervalMs=10000`
  - [ ] default `batchSize=500`
  - [ ] overflow safety flush logic
- [ ] Local file sink:
  - [ ] `loggers/<name>/YYYY-MM-DD.log`
  - [ ] retention cleanup via `file_retention_days` (default `7`, `0` disables)

**Done when:** SDK-only integration works without API keys using logger-name mapping.

---

## Phase 8 — CLI (`loggers`)

**Goal:** local log query tooling for operators/devs.

- [ ] Implement `loggers list`.
- [ ] Implement `loggers tail <name>`.
- [ ] Implement `loggers grep <name> <query>`.
- [ ] Implement `loggers show <name> --since ... --level ...`.
- [ ] Implement `loggers stats <name> --since ...` (D/I/W/E counts).
- [ ] Ensure CLI uses `loggers.yaml` + timezone.

**Done when:** local sink files are inspectable without the web UI.

---

## Phase 9 — Web UX Completion

**Goal:** all agreed UI interactions are delivered.

- [ ] Dashboard row design matches `fifos` style counts and color coding.
- [ ] Logger rows support drag/drop reorder.
- [ ] Logger detail header-right controls match todos action-area placement.
- [ ] Date window presets in header: `Today`, `Yesterday`, `Last 7 days`.
- [ ] Long rows are truncated in list.
- [ ] Click-to-expand dialog for full row content.
- [ ] Keep prominent SDK download affordance in detail view.

**Done when:** UI behavior matches spec patterns from `todos`/`fifos`.

---

## Phase 10 — Internal Dogfood Failure Sink

**Goal:** Loggers reports its own operational failures via internal logger table.

- [ ] Write normal-flow failures into control DB `logger` table.
- [ ] Include operation/ulid/error context in `data`.
- [ ] Add derived tags in `meta`.
- [ ] Recursion guard if failure sink itself fails.
- [ ] Fallback to stderr when sink write fails.

**Done when:** induced internal failures are visible in control DB without recursive collapse.

---

## Phase 11 — Chats2Me Pilot Migration

**Goal:** first real client (`../chats2me`) runs on Loggers successfully.

- [ ] Apply adapter/mapping plan from `docs/CHATS2ME_MIGRATION.md`.
- [ ] Ensure `component` coverage across chats2me logging paths.
- [ ] Fix level fidelity (no more flattening failures to info).
- [ ] Validate local sink + remote ingest dual visibility.
- [ ] Verify privacy constraints remain intact.

**Done when:** chats2me logs appear correctly in Loggers with meaningful D/I/W/E distribution.

---

## Phase 12 — Hardening, Test, Release

**Goal:** production-ready with confidence.

- [ ] Add unit tests for schema, validation, level filtering, SDK batching.
- [ ] Add integration tests for ingest/query/search/SSE replay/resync.
- [ ] Add load tests for high-volume ingest + batched SSE.
- [ ] Add smoke script (`lint + test + build`) and run clean.
- [ ] Final doc pass (`SPEC`, `PLAN`, migration notes).

**Done when:** all critical paths are tested, documented, and releasable.

---

## Active Decisions (locked)

- [x] Ingest auth is ULID-only (`/logger/:ulid/*`), no API key in v1.
- [x] Canonical event time is client-provided `logged_at`.
- [x] Date filters use presets (Today/Yesterday/Last 7 days), not free-form picker.
- [x] Log list paging default/max is `100`.
- [x] SDK default flush interval is `20s`; minimum allowed is `10s`.
- [x] SSE is batched for UI delivery; SDK ingest cadence is separate.
