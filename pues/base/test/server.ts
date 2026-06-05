// Server-only barrel for `pues/base/test/`. The harness boots a Bun server /
// SQLite DB and shells out to CLIs, so it's server/Bun-only by definition — like
// `base/db` and `base/cli` it ships a single `/server` barrel and no client
// default, failing fast at module resolution rather than bundling test + server
// code into the browser. Consumers `import { … } from "pues/base/test/server"`.

export {
  type BootOptions,
  bootTestService,
  type JsonResult,
  type TestService,
} from "./boot";
export { type RunCliOptions, type RunCliResult, runCli } from "./cli";
export { createTempDb, type TempDb, type TempDbOptions } from "./db";
export { createMemoryDb } from "./schema";
export {
  collectSseFrames,
  parseSseFrames,
  readSseStream,
  type SseFrame,
} from "./sse";
export { makeTempDir, type TempDir } from "./tmp";
