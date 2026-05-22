---
name: pues-pwa-setup
description: Wire the Pues PWA part — build manifest + service worker, serve them from Bun, register the SW on the client, and confirm required assets exist. Use when adding offline/installable support, debugging "PWA not installable" errors, or verifying icons after a rename.
---
# Pues PWA Setup

## What Pues Handles For You
Don't reimplement these — the `pwa` part already does them:

- **Manifest generation** (`buildPwaManifest`) — derives `name`, `short_name`,
  colours, and icon paths from `config/pues.yaml`. `pwa.*` overrides; otherwise
  `name` falls back to capitalised `core.name`, colours to `style.dark`.
- **Service-worker build** (`buildServiceWorker`) — runs workbox, precaches the
  manifest + icons, emits `dist/sw.js` + hash-named runtime chunks.
- **`buildPwa`** — one call that does both, wires the manifest revision into
  the precache (so a manifest edit busts SW cache on deploy), and defaults
  `cacheId` to `<pkg.name>-<pkg.version>`.
- **`mountPwaRoutes`** — serves `/manifest.json`, `/dist/sw.js` (with the right
  `Service-Worker-Allowed` / `Cache-Control` headers), the two icon URLs, and
  via its `fetch` fall-through the hash-named `dist/workbox-*.js` chunks.
- **`registerServiceWorker`** — handles registration + `controllerchange`
  auto-reload; no-ops where SW is unavailable.
- **`onReconnect`** — client-side online/offline bridge for "back online" UX.

Vendoring `pwa` implies vendoring `style` (manifest colours fall back to
`style.dark`). See [[pues-service-bootstrap]] for vendoring mechanics.

## 1) Consumer-Supplied Icons in `public/`
These are the **only** static assets the consumer must provide — `buildPwa`
does not generate PNGs.

Important path rule:
- `public/...` is the filesystem location.
- `pwa.icon192` / `pwa.icon512` are URL paths.
- Example: `public/loggers-192.png` is served at `/loggers-192.png`.

Recommended (avoid rename/path drift): set explicit icon URLs in
`config/pues.yaml` even when they match defaults:

```yaml
pwa:
  icon192: /loggers-192.png
  icon512: /loggers-512.png
```

Default naming still works when `pwa.icon*` is omitted:
- `public/<core-name>-192.png` -> `/<core-name>-192.png`
- `public/<core-name>-512.png` -> `/<core-name>-512.png`

`<core-name>` is `core.name` from `config/pues.yaml` (or checkout folder name
if unset). If renamed (`todos` -> `tasks`) and icons weren't renamed or
overridden, URLs 404 and installability breaks.

Quick check before build:
- `ls public/*.png`
- confirm the two icon files referenced by `pwa.icon192`/`pwa.icon512` exist.

## 2) Build Step
Add a `scripts/build-pwa.ts` (or fold into the existing build) that calls
`buildPwa`. List every static asset the SPA fetches as `additionalAssets` —
the generated manifest and the two icons are added automatically; anything
else (CSS, fonts, images) must be listed explicitly or it breaks offline.

Do **not** generate placeholder icon files in build scripts. Missing icons
should fail loudly so repos do not accidentally ship wrong assets.

```ts
import { buildPwa } from "pues/base/pwa/server";

await buildPwa({
  root: process.cwd(),
  additionalAssets: [
    { url: "/index.html", path: "public/index.html" },
    { url: "/assets/app.css", path: "public/assets/app.css" },
  ],
});
```

`cacheId` defaults to `<pkg.name>-<pkg.version>`; bumping `package.json`
version is the canonical way to force a SW cache bust on deploy.

## 3) Server Wiring
`mountPwaRoutes` returns `{ routes, fetch }` — spread the routes **and** call
the fetch fall-through, or workbox's hash-named runtime chunks will 404.

```ts
import { mountPwaRoutes } from "pues/base/pwa/server";

const pwa = await mountPwaRoutes({ root: process.cwd() });

export default {
  routes: { ...pwa.routes, ...puesSse.routes /* etc */ },
  async fetch(req: Request) {
    const pwaHit = await pwa.fetch(req);
    if (pwaHit) return pwaHit;
    return new Response("Not found", { status: 404 });
  },
};
```

## 4) Client Registration
One line at the SPA entry point:

```ts
import { registerServiceWorker } from "pues/base/pwa";

registerServiceWorker(); // defaults: /dist/sw.js, scope /, reload on controllerchange
```

For "back online" UX, pair with `onReconnect((online) => …)` from the same
barrel — it bridges `navigator.onLine` + `online`/`offline` events.

## Checklist
- [ ] `pwa.icon192` + `pwa.icon512` are explicitly set for the consumer, or
      the default `<core-name>-{192,512}.png` naming is intentionally used.
- [ ] Icon files referenced by those URLs exist under `public/` (filesystem).
- [ ] `mountPwaRoutes`'s `fetch` is wired as a fall-through, not just
      `routes` spread (otherwise workbox chunks 404).
- [ ] Every static asset the SPA fetches is either a pues default (manifest,
      icons) or listed in `additionalAssets`.
- [ ] `package.json` version is bumped on deploys that should bust the SW cache.
- [ ] `registerServiceWorker()` is called once in the web entry point.
