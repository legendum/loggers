---
name: pues-service-bootstrap
description: Bootstrap a consumer repo to use vendored Pues parts with scripts/pues.ts, config/pues.yaml, and correct path mapping. Use when creating a new Pues-backed service or adding Pues to an existing app.
disable-model-invocation: true
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

4. Add TS path mapping in consumer `tsconfig.json`:
   - `baseUrl: "."`
   - `paths: { "pues/*": ["types/pues/*", "pues/*"] }`

5. Vendor parts:
   - Run `bun run pues` in the consumer repo.
   - Commit `pues/`, `types/pues/` (if present), and `tsconfig.typecheck.json` (if copied).

6. Verify:
   - `bun run pues` exits cleanly.
   - Imports like `pues/base/auth/server` resolve in typecheck/build.
   - No runtime dependency on live `../pues` (only needed when re-vendoring).

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
