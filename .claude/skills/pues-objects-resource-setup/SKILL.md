---
name: pues-objects-resource-setup
description: Configure and mount Pues objects resources, including role mapping, parent-scoped routes, filters, method opt-outs, hooks, and SSE broadcasts. Use when wiring CRUD resources from config/pues.yaml.
---
# Pues Objects Resource Setup

## Goal
Expose table-backed REST resources via `mountResource` using `objects.resources` config, with minimal custom code and correct ownership semantics.

## 1) Define Resource Config
In `config/pues.yaml`, add each resource under `objects.resources`.

Top-level resource example:
```yaml
objects:
  resources:
    widgets:
      table: widgets
      filter:
        equals: [status]
        contains: [name]
```

Parent-scoped resource example:
```yaml
objects:
  resources:
    widget_items:
      table: widget_items
      prefix: /api/widgets/:widget_ulid
      parent:
        column: widget_id
        table: widgets
      methods: [GET, POST]
      filter:
        equals: [status]
```

## 2) Respect Role Mapping Defaults
`mountResource` resolves roles against table schema (via `resolveColumns`):
- Required defaults: `id`, `ulid`, `user_id`, `position`
- Optional defaults: `name`, `updated_at`, `created_at`, `meta`

If schema differs, map `columns:` explicitly. For parent-scoped resources, ownership is inherited via parent and `owner` must not be mapped on child.

## 3) Mount in Server Code
1. Load config with `loadPuesConfig()`.
2. Get resource configs and fail fast if missing.
3. Resolve parent columns before child if using `parent`.
4. Mount with `mountResource`.

```ts
import { loadPuesConfig, mountResource, resolveColumns } from "pues/base/objects";
import { resolveUser } from "pues/base/auth/server";

const puesConfig = await loadPuesConfig();
const widgetsCfg = puesConfig.objects?.resources?.widgets;
const itemsCfg = puesConfig.objects?.resources?.widget_items;
if (!widgetsCfg || !itemsCfg) throw new Error("Missing objects.resources config");

const widgetsCols = resolveColumns(getDb(), "widgets", widgetsCfg);

const widgetsRoutes = mountResource({
  db: getDb,
  name: "widgets",
  config: widgetsCfg,
  resolveUser,
  broadcast: puesSse.broadcast,
});

const itemRoutes = mountResource({
  db: getDb,
  name: "widget_items",
  config: itemsCfg,
  parentCols: widgetsCols,
  resolveUser,
  broadcast: puesSse.broadcast,
});
```

## When To Hand-Roll Routes Instead of `mountResource`
Stay on `mountResource` for standard top-level CRUD (fifos-style: `/api/fifos`,
`:id` is the row **ULID**, DnD via `PATCH` `{ before | after }`).

Hand-roll authenticated or public handlers when the product needs something
Pues list/detail routes do not model cleanly:
- **Slug-keyed management URLs** (`PATCH /api/things/:slug`) while public writes
  stay **ULID-keyed** (`POST /thing/:ulid/...`) — fifos uses ULID for both API
  surfaces; browser URLs use `/<slug>` only for SPA routing.
- **Enriched list payloads** (e.g. per-row aggregates from another DB/file).
- **Separate physical databases** per resource (loggers: `data/loggers/<ulid>.db`).
- **Bespoke reorder** (`PATCH /api/things/reorder` with `{ order: [slug, …] }`)
  instead of per-row `before`/`after` patches.

In those cases, mirror Pues **wire shape** (`id`, `label`, `position`, …) and
auth (`resolveUser`) so the React side can still use `useFilter`, `Dialog`, etc.,
even if `useResource` is not mounted for that entity.

## 4) Put App Rules in Hooks
Use hooks for app policy, not for generic transport:
- `beforeInsert` for validation, slug derivation, limits, billing.
- `beforeUpdate` for conditional rewrites/invariants.
- `beforeDelete` for cascade guards or domain checks.

Return `Response` for non-400 policy failures (402/403/409), or object to continue.
Billing in hooks: see [[pues-auth-billing-wiring]].

## 5) Keep SSE Coherent
`broadcast` is the function returned by `sseRoute(...)` — pass `puesSse.broadcast`
into each `mountResource` so built-in CRUD events flow automatically. For writes
that happen outside Pues routes, bridge via `broadcastRow` / `broadcastDelete`.
Details: [[pues-sse-setup]].

## Checklist
- [ ] Every mounted resource has `objects.resources.<name>` config.
- [ ] Parent-scoped resources define both `prefix` and `parent`.
- [ ] `methods` omits unsupported verbs instead of returning handler-level 403.
- [ ] Filter whitelists include only real table columns.
- [ ] Hooks enforce app rules; core CRUD stays in Pues.
