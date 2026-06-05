---
name: pues-testing-setup
description: Write integration tests for a Pues service with the base/test harness — boot the server in self-hosted mode against a temp DB, round-trip JSON, and tear down. Use when adding tests to a Pues-backed Bun service, or when you see hand-rolled PUES_DB_PATH / Bun.serve / resetDbForTesting test plumbing.
---
# Pues Testing Setup

## Goal
Stand up a Pues service in a test with no boilerplate: temp SQLite DB, self-hosted
mode (local user, billing skipped), server lifecycle, and a JSON fetch helper —
all from `base/test`'s `bootTestService`. Consumers stop re-typing the same
`PUES_DB_PATH` / `Bun.serve({...mod.default})` / `resetDbForTesting()` dance.

## When to use
- Adding integration tests that hit a consumer's `src/api/server.ts` over HTTP.
- You see hand-rolled test plumbing: setting `PUES_DB_PATH`, deleting/creating
  `data/*.db`, `Bun.serve({ ...mod.default })`, a bespoke `fetch` wrapper,
  `resetDbForTesting()` + unlink in `afterAll`. Replace it with `bootTestService`.

## Vendor the part
1. Add `test` to `config/pues.yaml`'s `pues:` list.
2. `bun run pues` to re-vendor (`test` pulls `db` transitively).
3. Import from `pues/base/test/server`.

## Pattern
```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootTestService, type TestService } from "pues/base/test/server";

let svc: TestService;
beforeAll(async () => {
  // Pass a THUNK that imports your server — boot sets env BEFORE the import,
  // so the module's first getDb() picks up the temp DB + self-hosted mode.
  svc = await bootTestService(() => import("../src/api/server"));
  // ...seed any fixtures here (see below)...
});
afterAll(async () => { await svc.stop(); });

test("creates a thing", async () => {
  const r = await svc.fetchJson("POST", "/api/things", { name: "x" });
  expect(r.status).toBe(201);
});
```

## Rules that matter
- **Pass a thunk, not an imported module.** `bootTestService(() => import("..."))`.
  The env (`PUES_DB_PATH`, unset `LEGENDUM_*`) must be set *before* the server
  module's top-level `getDb()` runs; the harness controls that ordering. A static
  `import` of the server at the top of the test file defeats it.
- **Schema is automatic.** `base/db`'s `getDb()` applies `config/schema.sql` +
  migrations on first call — the harness does nothing about schema.
- **`stop()` is mandatory** in `afterAll` — it stops the server, calls
  `resetDbForTesting()` (so the next file re-opens a fresh handle), and unlinks the
  temp DB. Wrap test bodies in try/finally if a single test boots its own service.
- **Self-hosted only.** The harness unsets Legendum creds so `resolveUser` mints
  the local user and billing is skipped. Don't test hosted/billing flows through it.

## Seeding: the consumer owns its fixtures
`base/test` boots the service; it does **not** know your tables. Keep
consumer-specific seeds in the consumer, composed after boot — mirroring
`ensureLocalUser`. Example (dojos' key-auth model):

```ts
// src/lib/keys.ts — find-or-create the local owner's account-level key,
// the analogue of pues ensureLocalUser; plus registerKey() as the test seam.
export function ensureLocalKey(ownerUserId: number): number { /* ... */ }
export function registerKey(input: RegisterKeyInput): number { /* ... */ }
```

Use `registerKey`-style helpers in a test to set up explicit / multi-actor /
scope scenarios; the happy path gets a default actor from the `ensure*` helper.

## Other helpers in `base/test`

All exported from `pues/base/test/server`:

- **`bootTestService` extras** — the returned service has `get/post/patch/del`
  convenience methods (besides `fetchJson`), and a `BootOptions.env` for vars the
  server module reads at load time (caps/flags), set *before* the import:
  `bootTestService(() => import("../src/api/server"), { env: { FIFOS_MAX_ITEMS_PER_FIFO: "5" } })`.
- **`createTempDb()`** — on-disk throwaway DB for the real `getDb()`: temp
  `PUES_DB_PATH` + self-hosted env + cleanup, no HTTP server. Returns
  `{ dbPath, getDb, stop }`. Call `getDb()` to apply `config/schema.sql`.
- **`createMemoryDb(schemaPath?)`** → a fresh `:memory:` DB with `config/schema.sql`
  applied, for data-layer tests that `mock.module` `getDb` to an in-memory handle
  (the `mock.module` wiring stays consumer-side).
- **`runCli(entry, args?, { cwd?, env?, stdin?, timeout? })`** →
  `{ stdout, stderr, exitCode }` — run a Bun CLI entry as a subprocess for
  end-to-end CLI tests. `stdin` pipes a string; `timeout` kills a hung child.
  Keep consumer-specific bindings (a fixed arg prefix, a `*_DOMAIN` env pointing
  at the test server) in a thin wrapper around it.
- **`makeTempDir(prefix?)`** → `{ dir, cleanup }` — scratch dir under the OS tmpdir
  (project files, a fake `$HOME`, written fixtures).
- **`parseSseFrames(text)` / `readSseStream(stream, ms)` / `collectSseFrames(stream, ms)`**
  — read a bounded SSE stream and parse its frames, for testing SSE routes.

## Checklist
- [ ] `test` in `config/pues.yaml`; `bun run pues` run.
- [ ] Import `bootTestService` from `pues/base/test/server`.
- [ ] Server passed as a thunk (`() => import(...)`).
- [ ] `await svc.stop()` in `afterAll`.
- [ ] Consumer-specific seeds live in the consumer, not in `base/test`.
