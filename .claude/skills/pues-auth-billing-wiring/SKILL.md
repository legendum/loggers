---
name: pues-auth-billing-wiring
description: Wire Pues hosted auth routes and Legendum billing primitives into a Bun service. Use when adding configureAuth, /pues auth endpoints, and charge/tab billing flows.
disable-model-invocation: true
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

2. Mount auth route maps in `Bun.serve({ routes })`:
   - `...mountAuthRoutes()`
   - `...mountLegendum()`
   - `...mountUserSettings()`

3. Use `resolveUser` for Pues resources/SSE requiring user identity.

## Minimal Example
```ts
import {
  configureAuth,
  mountAuthRoutes,
  mountLegendum,
  mountUserSettings,
  resolveUser,
} from "pues/base/auth/server";
import { getDb } from "pues/base/db/server";

configureAuth({ getDb, onNewUser: seedDefaultRowsForNewUser });

export default {
  routes: {
    ...mountAuthRoutes(),
    ...mountLegendum(),
    ...mountUserSettings(),
    // other routes...
  },
};
```

## Billing Pattern
1. Define symbolic billing names in `config/pues.yaml`:
   - `billing.charges.<name>` for one-shot charges.
   - `billing.tabs.<name>` for buffered usage charges.

2. For one-shot charges:
   - Use `chargeNamed({ accountToken, name })`.

3. For usage surfaces:
   - Create tab once per subject/token with `createTabFromConfig`.
   - Call `tab.add()` per billable action.
   - Close tabs on shutdown.

4. Normalize failures:
   - `isInsufficientFunds(result)` -> return 402.
   - `isTokenInvalid(result)` -> clear stored token and return relink response.

## Checklist
- [ ] Auth configured exactly once before handling requests.
- [ ] Auth routes mounted from Pues factories, not reimplemented.
- [ ] Billing names resolve from `config/pues.yaml` (no hardcoded amounts in handlers).
- [ ] Token-invalid flow clears stored token and asks user to relink.
- [ ] Tabs are closed on `SIGINT`/`SIGTERM`.
