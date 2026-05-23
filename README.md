# loggers

`loggers` is a Bun + Pues logging service with:

- Hosted/web UI for creating loggers and browsing logs
- Public ingest/query routes scoped by logger ULID
- `loggers.js` SDK for app/service logging
- `loggers` CLI for setup, emit, query, and tail

## Quick start

```bash
bun install
bun run dev
```

Build + type/lint/test smoke:

```bash
bun run smoke
```

## CLI

```bash
loggers help
loggers sdk
loggers alias app 01... info
loggers level app warn
loggers log --info "hello"
loggers show
loggers grep "timeout"
loggers tail
loggers skill
```

Target precedence:

1. `-l, --logger <ulid|name>`
2. `LOGGERS_ULID` in project `.env`
3. `LOGGERS_NAME` in project `.env`
4. `~/.config/loggers/loggers.yaml` fallback
5. interactive prompt

## SDK

```js
import { Loggers } from "./loggers.js";

const logger = Loggers.create({
  name: "app",
  component: "web",
});

logger.info({ msg: "started" });
await logger.flush();
```

Level precedence:

1. `options.level`
2. `LOGGERS_LEVEL`
3. `loggers.<name>.level` in config
4. `default_level` in config
5. `info`
