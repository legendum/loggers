---
name: pues-objects-resource-setup
description: Configure and mount Pues objects resources, including role mapping, parent-scoped routes, filters, method opt-outs, hooks, and SSE broadcasts. Use when wiring CRUD resources from config/pues.yaml.
disable-model-invocation: true
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

## 4) Put App Rules in Hooks
Use hooks for app policy, not for generic transport:
- `beforeInsert` for validation, slug derivation, limits, billing.
- `beforeUpdate` for conditional rewrites/invariants.
- `beforeDelete` for cascade guards or domain checks.

Return `Response` for non-400 policy failures (402/403/409), or object to continue.

## 5) Keep SSE Coherent
- Pass `broadcast` into `mountResource` for built-in CRUD events.
- If writes happen outside Pues routes, re-emit via:
  - `broadcastRow(...)` for created/updated rows.
  - `broadcastDelete(...)` for deletes.

## Checklist
- [ ] Every mounted resource has `objects.resources.<name>` config.
- [ ] Parent-scoped resources define both `prefix` and `parent`.
- [ ] `methods` omits unsupported verbs instead of returning handler-level 403.
- [ ] Filter whitelists include only real table columns.
- [ ] Hooks enforce app rules; core CRUD stays in Pues.
