# Loggers — Implementation Plan

Execution plan for building `loggers` in phased, check-offable steps.

Primary references:
- `docs/SPEC.md` (source of truth)
- `docs/CHATS2ME_MIGRATION.md` (first-client rollout)

**Implementation status:** Phases **1–9** are substantially landed in code. Remaining major work is mostly in phases **10–12** (dogfood sink hardening, client rollout, load/release hardening).

---

## How To Use This Plan

- Work top-to-bottom by phase.
- Keep checkboxes current in git as progress log.
- If scope changes, update `SPEC.md` first, then this file.

---

## Phase 0 — Project Setup & Guardrails

**Goal:** repo is ready for iterative implementation.

- [x] Create source tree (`src/api`, `src/lib`, `src/web`, `src/cli`).
- [x] `bun test` green (34/34).
- [x] Confirm `bun run lint`, `bun run build`, `bun run smoke` clean.
- [x] `docs/PLAN.md` live as the checklist.
- [x] Coding baseline is Pues-first (mirrors `fifos` conventions).

**Done when:** `bun run smoke` is green.

---

## Phase 1 — Pues Adoption Baseline

**Goal:** lean into Pues modules as much as `fifos`.

- [x] `config/pues.yaml` includes: `core`, `theme`, `style`, `auth`, `billing`, `db`, `objects`, `sse`, `pwa`.
- [x] `bun run pues` vendoring complete; imported parts compile.
- [x] Pues auth wired (`configureAuth`, `mountAuthRoutes`, `mountLegendum`, `mountUserSettings`, `withSelfHostedSession`).
- [x] Pues billing tabs wired (`chargeLoggerCreate`, `chargeIngestWrite`, `closeBillingTabs` in `src/lib/billing.ts`).

**Done when:** app starts with Pues auth + billing plumbing enabled. ✓

---

## Phase 2 — Data Layer & Schemas

**Goal:** DB layout and schema implemented exactly as spec'd.

- [x] Control DB `data/loggers.db`, schema in `config/schema.sql` (`users`, `loggers` with `meta` column, internal `logger` sink table).
- [x] Per-logger DB `data/loggers/<ulid>.db`, schema in `config/schema-logger.sql`.
- [x] Per-logger `logger` table: `logged_at`, `level`, `component`, `data`, `meta`.
- [x] Indexes on `(logged_at)`, `(level, logged_at)`, `(component, logged_at)`.
- [x] Search via case-insensitive `LIKE` over component/data/meta (no FTS — see SPEC §3.3).
- [x] WAL mode + `PRAGMA foreign_keys = ON` on every connection (`src/lib/loggerDb.ts`).
- [x] LRU + idle eviction (`LOGGERS_MAX_OPEN_DBS`, `LOGGERS_DB_IDLE_MS`).
- [x] Eager `provisionLoggerDb` on POST via custom `newId` in `mountResource`.

**Done when:** creating a logger provisions a writable per-logger DB and schema. ✓

---

## Phase 3 — Logger Management API + Dashboard Backbone

**Goal:** users can manage loggers and order them.

- [x] `GET /api/loggers` (pues `mountResource`).
- [x] `POST /api/loggers` (slug + ulid mint + per-user cap + billing create charge).
- [x] `PATCH /api/loggers/:ulid` for rename (re-derives slug).
- [x] `PATCH /api/loggers/:ulid` with `{ before | after }` for reorder (pues `objects` convention — replaces the originally-planned bulk `/reorder` endpoint).
- [x] `DELETE /api/loggers/:ulid` removes row and per-logger DB file (`beforeDelete` calls `deleteLoggerDb(existing.id)`).
- [x] `GET /api/loggers/level-counts` flat `{ parent_id, value, n }[]` for D/I/W/E pills.

**Done when:** dashboard CRUD + drag reorder work end-to-end. ✓ (tests pass; browser verification pending)

---

## Phase 4 — Ingestion Pipeline (ULID-Scoped)

**Goal:** high-volume ingest works with spec constraints.

- [x] `POST /logger/:ulid/ingest`.
- [x] `POST /logger/:ulid/batch` (default/max batch handling via `LOGGERS_MAX_BATCH`).
- [x] Level validation (`debug|info|warn|error` only, 400 on unknown).
- [x] Required `component` (max 128 chars), `data` (JSON object, max 64 KB), `logged_at` (positive integer ms).
- [x] Client-provided `logged_at` preserved as canonical event time.
- [x] Post-processing derives `meta` from `data` (`src/lib/postProcess.ts` — extracts canonical fields + sensitive-key redaction).
- [x] Pues tab charges on accepted writes (`chargeIngestWrite`).
- [x] Unknown ULID → `404 not_found` (`reason: ulid`).

**Done when:** SDK payloads write successfully and appear queryable by `logged_at`. ✓

---

## Phase 5 — Query, Search, Paging

**Goal:** read APIs match UI behavior and scale expectations.

- [x] `GET /logger/:ulid/logs` (`src/lib/logsQuery.ts`).
- [x] `window=today|yesterday|last_7_days` with viewer-tz resolution (`src/lib/logWindow.ts`).
- [x] Optional `level`, `component` filters.
- [x] Keyset paging via `limit`/`cursor`, default/max `100`.
- [x] `next_cursor` returned when more data exists.
- [x] Chronological order by `(logged_at, id)`.
- [x] `GET /logger/:ulid/search?q=...` via `LIKE` substring scan.

**Done when:** UI/CLI can paginate and filter logs reliably without time-order regressions. ✓

---

## Phase 6 — SSE Realtime (Batched)

**Goal:** realtime tail handles very high event volume safely.

- [x] `GET /logger/:ulid/events` (`src/lib/loggerTailSse.ts` + `src/api/handlers/eventsApi.ts`).
- [x] `logs_batch` and `resync` events.
- [x] `SSE_BATCH_MAX_EVENTS` (default 200) + `SSE_BATCH_MAX_MS` (default 250).
- [x] Chronological order within each batch.
- [x] `Last-Event-ID` replay via per-stream ring buffer (`SSE_REPLAY_BUFFER_BATCHES`, default 200).
- [x] `resync` emitted when replay window exceeded.
- [x] 25s keep-alive comments.
- [ ] **Known edge case:** ring-tail check `parsed < tail - 1` may double-deliver one batch at boundary. Add targeted test before shipping.

**Done when:** live tail stays responsive under burst load and reconnects safely.

---

## Phase 7 — SDK (`loggers.js`)

**Goal:** SDK is the primary ingestion interface.

- [x] Serve SDK at `GET /loggers.js` (public, stable URL).
- [x] `Loggers.create({ name?, ulid?, component, level?, flushIntervalMs?, batchSize?, local?, fileRetentionDays? })`.
- [x] `debug/info/warn/error`, `flush`, `close`.
- [x] `loggers.yaml` resolution for name-based config (`timezone`, `default_level`, per-name `ulid`/`level`/`file_retention_days`) with `LOGGERS_CONFIG_PATH` override.
- [x] Config lookup order implemented: `LOGGERS_CONFIG_PATH` → `./loggers.yaml` → `~/.config/loggers/loggers.yaml`.
- [x] Client-side level filtering (silent drop) with default level `info`.
- [x] `LOGGERS_LEVEL` env threshold supported in SDK runtime (`options.level` still wins).
- [x] `LOGGERS_NAME` + `LOGGERS_ULID` env pair can map `Loggers.create({ name })` to a remote ULID target.
- [x] Batching: default `flushIntervalMs=20000`, floor `10000`, default `batchSize=500`.
- [x] Local file sink `loggers/<name>/YYYY-MM-DD.log` with retention cleanup.
- [x] Missing `name` alias behavior: remote writes are skipped; local sink still runs when enabled.
- [x] Same minimum level threshold gates both remote writes and local-file writes.
- [ ] Optional future enhancement: robust YAML parser + retry/backoff strategy (current parser is minimal + no jitter retry loop).

**Done when:** SDK-only integration works without API keys using logger-name mapping. ✓

---

## Phase 8 — CLI (`loggers`)

**Goal:** companion CLI for remote logger operations plus local alias/config management.

- [x] `loggers` / `loggers info`.
- [x] `loggers sdk`.
- [x] `loggers log [--debug|--info|--warn|--error] [--component C] <text-or-json>` (arg or stdin payload).
- [x] `loggers alias <name> <ulid> [level]` writes alias + optional level in `~/.config/loggers/loggers.yaml`.
- [x] `loggers level <name> <level>` updates per-alias level in global config.
- [x] `loggers show`, `loggers grep <query>`, `loggers tail`.
- [x] `-l, --logger <ulid|name>` (ULID or name).
- [x] Target precedence wired: flag override → `.env` → global config fallback chain → interactive prompt save.
- [x] Project `.env` supports both `LOGGERS_ULID` and `LOGGERS_NAME` target resolution.
- [x] `loggers log` level precedence wired: CLI flag → `.env` (`LOGGERS_LEVEL`) → YAML config → `info`.
- [x] Global config path normalized to `$HOME/.config/loggers/loggers.yaml` (no XDG variant).
- [x] Implicit global alias fallback: `loggers.loggers.dev`.
- [ ] Optional future enhancement: local-file inspection commands (`list`, `stats`, etc.) if product scope returns there.

**Done when:** core remote workflows + alias management are operational. ✓

---

## Phase 9 — Web UX Completion

**Goal:** all agreed UI interactions are delivered.

- [x] Dashboard row with `D I W E` count pill (`LevelCountsPill.tsx`), color-coded per level (`.level-count--*` rules in `main.css`).
- [x] Logger rows support drag/drop reorder via `@dnd-kit` + `useDndPositions`.
- [x] Logger detail header-right action area (date-window chips in `ObjectDetail` `actions` prop).
- [x] Date window presets `Today` / `Yesterday` / `Last 7 days`.
- [x] Log row truncation in list (`.log-row-msg` with `overflow: hidden`).
- [x] Click-to-expand dialog for full row content (with `data` + `meta` JSON drawer).
- [x] Prominent SDK download affordance in detail view (`/loggers.js` download link).
- [x] `.row-main` CSS bug fixed (uses `flex: 0 0 100%` per fifos).
- [ ] Browser-verify the above in a real session (tests don't cover visual).

**Done when:** UI behavior matches spec patterns from `todos`/`fifos`.

---

## Phase 10 — Internal Dogfood Failure Sink

**Goal:** Loggers reports its own operational failures via internal logger table. **Schema present, code not written.**

- [x] Control DB `logger` table exists (`config/schema.sql`).
- [ ] Write normal-flow failures into control DB `logger` table.
- [ ] Include operation/ulid/error context in `data`.
- [ ] Derived tags in `meta`.
- [ ] Recursion guard if failure sink itself fails.
- [ ] Fallback to stderr when sink write fails.

**Done when:** induced internal failures are visible in control DB without recursive collapse.

---

## Phase 11 — Chats2Me Pilot Migration

**Goal:** first real client (`../chats2me`) runs on Loggers successfully. **Not started.**

- [ ] Apply adapter/mapping plan from `docs/CHATS2ME_MIGRATION.md`.
- [ ] Ensure `component` coverage across chats2me logging paths.
- [ ] Fix level fidelity (no more flattening failures to info).
- [ ] Validate local sink + remote ingest dual visibility.
- [ ] Verify privacy constraints remain intact.

**Done when:** chats2me logs appear correctly in Loggers with meaningful D/I/W/E distribution.

---

## Phase 12 — Hardening, Test, Release

**Goal:** production-ready with confidence.

- [x] Unit + integration tests for schema, validation, query, and SSE replay/resync.
- [x] Targeted tests for CLI alias resolution and SDK alias fallback behavior.
- [ ] Load tests for high-volume ingest + batched SSE.
- [x] `bun run smoke` (lint + test + tsc + build) clean.
- [x] Final doc pass (`SPEC`, `PLAN`) aligned to implemented behavior.

**Done when:** all critical paths are tested, documented, and releasable.

---

## Active Decisions (locked)

- [x] Ingest auth is ULID-only (`/logger/:ulid/*`), no API key in v1.
- [x] Canonical event time is client-provided `logged_at`.
- [x] Date filters use presets (Today/Yesterday/Last 7 days), not free-form picker.
- [x] Log list paging default/max is `100`.
- [x] SDK default flush interval is `20s`; minimum allowed is `10s`.
- [x] SSE is batched for UI delivery; SDK ingest cadence is separate.
- [x] Reorder uses pues `objects` `{ before | after }` anchor on per-row PATCH (not a bulk `/reorder` endpoint).
- [x] Per-logger DB provisioned eagerly on POST (via custom `newId`), not lazily on first ingest.
- [x] Seed "My first logger" on new user (`onNewUser: seedDefaultLoggerForNewUser`), mirroring fifos.
- [x] CLI + SDK global alias/config path is `$HOME/.config/loggers/loggers.yaml` (no XDG variant).
- [x] CLI global fallback alias includes `loggers.loggers.dev`.
- [x] SDK unresolved `name` disables remote writes instead of throwing; optional local sink can continue.
- [x] Default minimum level is `info` unless explicitly overridden (options/config/env).
- [x] In SDK runtime, `LOGGERS_NAME` + `LOGGERS_ULID` can map name-based logger creation to a concrete remote ULID.
