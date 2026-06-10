---
name: pues-part-authoring
description: Author or extend a Pues part — add a base/<part> or a new exported component/hook, keeping the barrel, hand-curated .d.ts type surface, manifest deps, and style/defaults.css in sync. Use when developing Pues itself (not when consuming it).
---
# Pues Part Authoring

For working **inside the Pues repo** — adding a new `base/<part>`, or a new
exported symbol to an existing part. (Consuming Pues from an app is
[[pues-service-bootstrap]]; cutting a version is [[pues-release]].)

The trap this skill exists to prevent: Pues' consumer type surface lives in
**hand-curated `.d.ts` stubs** under `types/pues/base/<part>/`, *not* generated
from source. The path mapping `pues/*: ["types/pues/*", "pues/*"]` resolves the
`.d.ts` **first**, so a symbol you export from the source barrel but forget to
add to the `.d.ts` is invisible to consumers — their `tsc` fails with
`TS2305: Module '"pues/base/<part>"' has no exported member 'X'`. The source and
the `.d.ts` must move together.

## Adding a new exported component / hook to an existing part
1. Write the source in `base/<part>/`.
2. Export it from the part's **client barrel** `base/<part>/index.ts` (and
   `base/<part>/server.ts` if it touches `node:`/Bun — client-safe default, see
   SPEC §9.6).
3. **Mirror it in the hand-curated type stub** `types/pues/base/<part>/index.d.ts`.
   Match the existing house style — loose is fine and intended: `any` for React
   return types and props you don't need consumers to check; spell out only the
   props that matter (e.g. a string-literal union). Skipping this is the #1
   mistake.
4. If the new code imports *another* part (e.g. a component pulls `Dialog` from
   `../objects`), add that part to this part's `depends` in
   **`base/core/manifest.ts`** — and check you didn't create a cycle.
5. Styling ships through **`base/style/defaults.css`** (`.pues-*` classes,
   compiled into `pues.css` by `buildStyle`). There is no per-part CSS file; add
   classes there.

## Adding a whole new part `base/<name>/`
- All of the above, plus register the part in **`PUES_MANIFEST`**
  (`base/core/manifest.ts`) with its `depends`. Unregistered parts throw at
  vendor time (`resolveDeps`).
- Give it a client barrel `index.ts`; add `server.ts` only if it has a
  server/Bun surface (`base/db`, `base/pwa`, `base/test` are server-only).
- Add a `types/pues/base/<name>/` stub directory if you want a curated type
  surface; if you skip it, consumers resolve the part from source via the path
  mapping (works, but loses the loose-`any` insulation — `base/cli`/`base/test`
  do this).

## Verify before you ship
- **`bun run smoke`** in the Pues repo (lint + test + tsc) — required.
- Then re-vendor a consumer that uses the part (`bun run pues`) and run its
  build + `tsc` — this is what catches a missing `.d.ts` export, since the Pues
  repo's own `tsc` checks source, not the consumer-facing stub.
- Release with [[pues-release]] when ready (bump, `docs/TAGS.md`, tag).

## Checklist
- [ ] Source written; exported from `index.ts` (and `server.ts` if needed).
- [ ] `types/pues/base/<part>/index.d.ts` updated to match the barrel.
- [ ] New cross-part imports reflected in `manifest.ts` `depends` (no cycle).
- [ ] Styling added to `base/style/defaults.css` (not a per-part file).
- [ ] `bun run smoke` passes; a re-vendored consumer builds + type-checks.
- [ ] Shipping it? Cut a tag via [[pues-release]] (bump + `docs/TAGS.md` + `v`-tag).
