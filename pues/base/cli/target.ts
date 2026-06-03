/**
 * `resolveTarget` — the credential/target resolution ladder every fleet
 * CLI re-implements. It answers "which thing am I acting on?" from, in
 * order:
 *
 *   1. a per-call override (the `-l`/`-f`/`--dojo` flag value)
 *   2. the project file (`KEY=…` in `.env`, or `.dojo` for dj)
 *   3. the process env var (todos also honours `$TODOS_LIST_URL`)
 *   4. an optional global-config lookup (loggers' aliases, dj defaults)
 *   5. an interactive prompt — saved back to the project file
 *
 * The "thing" is opaque: a 26-char ULID for loggers/fifos/dj, a list
 * URL for todos. `validate` gates each candidate (exit(2) on a bad
 * value, like the old `normalizeUlid`); `normalize` shapes the accepted
 * value (e.g. upper-case a ULID). Steps 4 and 5 are opt-in: omit
 * `resolveGlobal` to skip the global layer, set `save: false` to not
 * persist a prompted value, and a non-TTY with nothing resolved exits(2)
 * with `errorHint`.
 */

import { readProjectValue, writeProjectValue } from "./config";
import { prompt } from "./io";

export type TargetSource = "flag" | "file" | "env" | "global" | "prompt";

export type ResolvedTarget = {
  value: string;
  source: TargetSource;
};

export type TargetSpec = {
  /** Per-call override (a flag value), if any. */
  flag?: string | null;
  /** Project file holding the credential. Default `.env`. */
  file?: string;
  /** Key within the project file (and the write-back target). */
  key: string;
  /** Also consult `process.env[envVar]` (step 3) when set. */
  envVar?: string;
  /** Optional global-config lookup (step 4). */
  resolveGlobal?: () => string | null;
  /** Validate a candidate; return false to reject (→ exit 2). */
  validate?: (value: string) => boolean;
  /** Shape an accepted value (e.g. upper-case). Default: trim. */
  normalize?: (value: string) => string;
  /** Human name of the credential, woven into the invalid-value message
   * (e.g. `label: "fifo ULID"` → "...: invalid fifo ULID"). Default "value". */
  label?: string;
  /** Prompt label for step 5 (e.g. "Enter your Dojo ULID: "). */
  promptLabel: string;
  /** Persist a prompted value back to the project file. Default true. */
  save?: boolean;
  /** stderr message when nothing resolves and stdin is not a TTY. */
  errorHint?: string;
};

function accept(
  raw: string,
  source: TargetSource,
  ctx: string,
  spec: TargetSpec,
): ResolvedTarget {
  const trimmed = raw.trim();
  if (spec.validate && !spec.validate(trimmed)) {
    console.error(`${ctx}: invalid ${spec.label ?? "value"}`);
    process.exit(2);
  }
  const value = spec.normalize ? spec.normalize(trimmed) : trimmed;
  return { value, source };
}

export function resolveTarget(spec: TargetSpec): ResolvedTarget {
  const file = spec.file ?? ".env";

  if (spec.flag?.trim()) {
    return accept(spec.flag, "flag", "override flag", spec);
  }

  const fromFile = readProjectValue(spec.key, file);
  if (fromFile) {
    return accept(fromFile, "file", `${spec.key} in ${file}`, spec);
  }

  if (spec.envVar) {
    const fromEnv = process.env[spec.envVar]?.trim();
    if (fromEnv) {
      return accept(fromEnv, "env", `$${spec.envVar}`, spec);
    }
  }

  if (spec.resolveGlobal) {
    const fromGlobal = spec.resolveGlobal()?.trim();
    if (fromGlobal) {
      return accept(fromGlobal, "global", "global config", spec);
    }
  }

  if (!process.stdin.isTTY) {
    console.error(
      spec.errorHint ??
        `${spec.key} not set. Set it in ${file}, pass the override flag, or run interactively.`,
    );
    process.exit(2);
  }

  const raw = prompt(spec.promptLabel);
  if (!raw) {
    console.error("Nothing provided.");
    process.exit(2);
  }
  const resolved = accept(raw, "prompt", "prompt", spec);
  if (spec.save !== false) {
    writeProjectValue(spec.key, resolved.value, file);
  }
  return resolved;
}
