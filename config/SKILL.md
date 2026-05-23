# Loggers

Use the `loggers` CLI and `loggers.js` SDK to emit and inspect structured logs.

## Setup

- Put `LOGGERS_ULID` or `LOGGERS_NAME` in `.env` in your project folder.
- `LOGGERS_LEVEL` sets the default minimum level (`debug|info|warn|error`) when call-level overrides are absent.
- Manage global name mappings in `~/.config/loggers/loggers.yaml`:
  - `loggers.<name>.ulid`
  - `loggers.<name>.level`

## CLI quick use

- `loggers info` — show resolved target and latest sample.
- `loggers log --info "message"` — emit one line.
- `loggers show` — list logs.
- `loggers grep "timeout"` — search text.
- `loggers tail` — follow new lines.
- `loggers alias <name> <ulid> [level]` — save/update mapping.
- `loggers level <name> <level>` — update only level.
- `loggers sdk` — download `./loggers.js`.

## SDK

```js
import { Loggers } from "./loggers.js";

const logger = Loggers.create({ name: "api", component: "web" });
logger.info({ msg: "started" });
await logger.flush();
```
