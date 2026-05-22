---
name: pues-auth-billing-wiring
description: Wire Pues hosted auth routes and Legendum billing primitives into a Bun service. Use when adding configureAuth, /pues auth endpoints, and charge/tab billing flows.
---
# Pues Auth Billing Wiring

## Use This Skill For
- Adding hosted auth to a Pues service.
- Mounting `/pues/auth/*`, `/pues/legendum/*`, and `/pues/me`.
- Charging fixed actions and usage-based writes via Pues billing.

## Prerequisites
- `config/pues.yaml` includes `auth` and `billing`.
- Consumer has a canonical `users` table or provides custom `UserStorage`.
- Hosted mode env vars are set:
  - `LEGENDUM_API_KEY`
  - `LEGENDUM_SECRET`
  - `PUES_COOKIE_SECRET`
  - `PUES_DOMAIN`
  - optional: `PUES_LINK_KEY_MAX_AGE_SECONDS`

## Server Wiring Pattern
1. Configure auth once at startup:
   - `configureAuth({ getDb, onNewUser })` for canonical schema.
   - Or `configureAuth({ storage, onNewUser })` for custom schema.
2. Mount route maps in `Bun.serve({ routes })`:
   `...mountAuthRoutes()`, `...mountLegendum()`, `...mountUserSettings()`.
3. Use `resolveUser` for Pues resources/SSE requiring user identity.

## Minimal Example
```ts
import {
  configureAuth, mountAuthRoutes, mountLegendum, mountUserSettings, resolveUser,
} from "pues/base/auth/server";
import { getDb } from "pues/base/db/server";

configureAuth({ getDb, onNewUser: seedDefaultRowsForNewUser });

export default {
  routes: { ...mountAuthRoutes(), ...mountLegendum(), ...mountUserSettings() },
};
```

## Billing Pattern
Billing lives in `pues/base/billing/server`. Define symbolic names in
`config/pues.yaml` under `billing.charges.<name>` (one-shot) or
`billing.tabs.<name>` (buffered usage). Never hardcode amounts in handlers.

- One-shot: `await chargeNamed({ accountToken, name: "widget.create" })`.
- Usage: build the tab once per subject/token, `add` per action, close on shutdown.
- Normalize: `isInsufficientFunds(r)` → 402; `isTokenInvalid(r)` → clear token + relink.

```ts
import { chargeNamed, createTabFromConfig, isInsufficientFunds, isTokenInvalid }
  from "pues/base/billing/server";

const tab = createTabFromConfig({
  subject: userId, accountToken, name: "writes",
  onTokenInvalid: () => clearStoredToken(userId),
});
const r = await tab.add();
if (isInsufficientFunds(r)) return new Response(null, { status: 402 });

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => tab.close());
```

Billing inside CRUD usually belongs in `beforeInsert`/`beforeUpdate` hooks —
see [[pues-objects-resource-setup]].

## Checklist
- [ ] Auth configured exactly once before handling requests.
- [ ] Auth routes mounted from Pues factories, not reimplemented.
- [ ] Billing names resolve from `config/pues.yaml` (no hardcoded amounts in handlers).
- [ ] Token-invalid flow clears stored token and asks user to relink.
- [ ] Tabs are closed on `SIGINT`/`SIGTERM`.
