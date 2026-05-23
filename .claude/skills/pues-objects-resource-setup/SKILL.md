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

The `ulid` (public id) is minted by the default `newId`, which is `ulid()` from `pues/base/core` (a 26-char ULID). To use a different id shape, pass your own `newId` to `mountResource` — e.g. `newId: () => ulid(20)` for shorter public ids. Don't import a local id generator; ULID helpers live in core (see [[pues-service-bootstrap]]).

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
Billing in hooks: see [[pues-auth-billing-wiring]].

## 5) Keep SSE Coherent
`broadcast` is the function returned by `sseRoute(...)` — pass `puesSse.broadcast`
into each `mountResource` so built-in CRUD events flow automatically. For writes
that happen outside Pues routes, bridge via `broadcastRow` / `broadcastDelete`.
Details: [[pues-sse-setup]].

## 6) Wire the Home ↔ Detail URL with `useSlugRouting`
Apps with a `/` home list and `/:slug` detail page should use
`useSlugRouting` instead of hand-rolling slug → row resolution. It owns
the URL ↔ selection round-trip and composes `useFilterQuery` so a shared
filter input clears on every home ↔ detail transition.

```tsx
import { useResource, useSlugRouting } from "pues/base/objects";

type WidgetRow = Row<{ slug: string }>;

const resource = useResource<WidgetRow>("widgets", { enabled: !!user });
const {
  selected,        // WidgetRow | null
  select,          // (row) => void  — pushState + setSelected
  goBack,          // ()  => void  — pushState("/") + clear
  filterQuery,
  setFilterQuery,
} = useSlugRouting<WidgetRow>({
  resource,
  enabled: !!user,
  excludePathPrefixes: ["api/", "pues/", "dist/"],
});
```

Load-bearing behaviour — do not reimplement these from scratch:
- **Id-match wins over slug-match.** A rename (slug changes, id stable)
  keeps tracking the same row; URL is `replaceState`d to the new slug.
- **Holds last selection through transient empty-rows.** On reload,
  `useResource` reports `loading=false, rows=[]` for one tick before the
  fetch resolves. A naive "clear if not found" would bounce the detail
  page back to home — that was the reload-redirect bug. The hook does
  not clear on a transient miss.
- **Empty URL slug → home.** Always clears.

Optional escape hatches:
- `resolveExternal: (slug) => Promise<Row | null>` — async fallback when
  the slug isn't in `resource.rows`. Use for offline caches or
  dedicated `/${slug}.json` endpoints (todos's pattern).
- `onSlugChanged: (oldSlug, newSlug) => void` — fires after the hook
  has `replaceState`d. Plug in app-specific side effects like re-keying
  a slug-keyed offline cache.

Don't fold `useFilterQuery` and `useSlugRouting` separately when both
apply — the composition is the whole point. Apps without slug routing
keep using `useFilterQuery` directly.

## 7) Offline Row Cache for PWAs with `useOfflineRowCache`
For PWA-installed apps that want cold reloads to render the home list
(and let detail-page URLs resolve) before the live `useResource` fetch
returns, mirror `resource.rows` into IndexedDB:

```tsx
import {
  createOfflineRowCache,
  useOfflineRowCache,
  useResource,
} from "pues/base/objects";

// Module scope — shared by non-React paths (e.g. background reconnect).
export const listCache = createOfflineRowCache<unknown, ListEntry>({
  dbName: "todos-offline",
  metaKey: "lists",
});

// In App.tsx — React side keeps the cache fresh on every rows change.
useOfflineRowCache(resource, {
  dbName: "todos-offline",
  metaKey: "lists",
  enabled: !!user,
  project: (row) => projectIntoCachedShape(row),  // optional
});

// Wire the detail-page cache fallback into useSlugRouting:
useSlugRouting({
  resource,
  resolveExternal: (slug) => listCache.findBy("slug", slug),
  ...
});
```

Notes:
- One IDB DB per app (`dbName`), one shared `meta` object store keyed
  by `metaKey` — typically the resource name. Multiple resources can
  share the DB by picking distinct keys.
- The hook only writes when `resource.rows.length > 0` — it won't
  clobber a previous snapshot during the transient empty-rows window
  on cold reload.
- The module-scope `createOfflineRowCache` and the React hook write to
  the same IDB store; writes are idempotent.

## Checklist
- [ ] Every mounted resource has `objects.resources.<name>` config.
- [ ] Parent-scoped resources define both `prefix` and `parent`.
- [ ] `methods` omits unsupported verbs instead of returning handler-level 403.
- [ ] Filter whitelists include only real table columns.
- [ ] Hooks enforce app rules; core CRUD stays in Pues.
- [ ] Home ↔ detail apps use `useSlugRouting`, not a bespoke
      slug/popstate/select effect chain.
- [ ] PWA apps that want offline cold-reloads use `useOfflineRowCache`
      and wire `listCache.findBy` into `useSlugRouting.resolveExternal`.
