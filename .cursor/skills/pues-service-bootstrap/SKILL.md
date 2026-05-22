---
name: pues-service-bootstrap
description: Bootstrap a consumer repo to use vendored Pues parts with scripts/pues.ts, config/pues.yaml, and correct path mapping. Use when creating a new Pues-backed service or adding Pues to an existing app.
---
# Pues Service Bootstrap

## Goal
Set up a consumer repo so `bun run pues` vendors parts from sibling `../pues` into committed `pues/` and `types/pues/`.

## Workflow
1. Confirm topology:
   - Consumer repo and framework repo are siblings.
   - Framework path from consumer should be `../pues`.

2. Generate bootstrap files from the framework repo:
   - Run `bun run scripts/repo.ts <consumer-repo-name>` from `../pues`.
   - This writes `scripts/pues.ts`, ensures `config/pues.yaml`, and adds `package.json` script `pues`.

3. Set `config/pues.yaml` parts:
   - Add only what the consumer needs under `pues:`.
   - Dependencies are auto-pulled from `PUES_MANIFEST` when vendoring.

4. Add DB schema baseline when app is SQLite-backed:
   - Add `config/schema.sql` as the canonical SQL shape for control + tenant DBs.
   - Keep it aligned with `docs/SPEC.md`; treat code migrations as implementations of this file.

5. Add TS path mapping in consumer `tsconfig.json`:
   - Ensure root `tsconfig.json` exists before typecheck runs.
   - `baseUrl: "."`
   - `paths: { "pues/*": ["types/pues/*", "pues/*"] }`

6. Vendor parts:
   - Run `bun run pues` in the consumer repo.
   - Commit `pues/`, `types/pues/` (if present), and `tsconfig.typecheck.json` (if copied).

7. Verify:
   - Run `bun install` if toolchain/type deps are missing.
   - `bun run pues` exits cleanly.
   - `bun run tsc` passes.
   - Imports like `pues/base/auth/server` resolve in typecheck/build.
   - No runtime dependency on live `../pues` (only needed when re-vendoring).

## Bootstrap Sanity Checklist
- [ ] `config/pues.yaml` has required parts for the service.
- [ ] `config/schema.sql` exists for SQLite services and matches the spec.
- [ ] Root `tsconfig.json` exists and includes `baseUrl` + `pues/*` paths.
- [ ] `bun run pues` and `bun run tsc` both pass.
- [ ] If a plan/checklist doc exists (for example `docs/PLAN.md`), mark completed setup items.

## Starter Parts
Use this baseline for a typical Pues PWA service:

```yaml
pues:
  - core
  - theme
  - style
  - db
  - auth
  - objects
  - sse
  - pwa
  - billing
```

Trim this list if the consumer does not need all features.

## Rules
- Keep `scripts/pues.ts` constant across consumers.
- Do not gitignore vendored `pues/` or `types/pues/`.
- Add new features by editing `config/pues.yaml` then re-running `bun run pues`.
- Trust dependency closure from `PUES_MANIFEST`; do not hand-copy dependencies.
- Keep `config/schema.sql` as the human-readable schema source for SQLite-backed services.

## Next
Once parts are vendored, wire them: [[pues-auth-billing-wiring]] for auth/billing
routes, [[pues-objects-resource-setup]] for CRUD resources and SSE.
