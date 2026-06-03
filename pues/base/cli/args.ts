/**
 * `parseArgs` — the dependency-free argv parser shared by the fleet's
 * CLIs (`loggers`, `fifos`, `todos`, `dj`). One pass over `argv`, no
 * `commander`/`yargs`.
 *
 * Shape: the first bare (non-dash) token is the `command`; subsequent
 * bare tokens are `positional`; everything else lands in `flags`.
 *
 * Flag grammar:
 *   --name=value   → flags.set("name", "value")
 *   --name value   → flags.set("name", "value")   (value-taking)
 *   --name         → flags.set("name", true)       (boolean)
 *   -x ... / -x=v  → same, after mapping `x` via `shortFlags` to its
 *                    long name (unmapped shorts key on the letter)
 *
 * Whether `--name` consumes the next token or is boolean is decided by
 * `booleanFlags`: names in that set are *always* boolean (the loggers
 * model — `--json` stays boolean even before a positional). For names
 * not in the set we fall back to the lookahead heuristic (the fifos
 * model — consume the next token unless it is another flag). A CLI that
 * wants every flag's arity pinned simply lists its booleans.
 */

export type FlagValue = string | true;

export type ParsedArgs = {
  /** First bare token, or `null` when argv starts with a flag / is empty. */
  command: string | null;
  /** Bare tokens after the command, in order. */
  positional: string[];
  /** Long-flag name → value (`true` for boolean flags). */
  flags: Map<string, FlagValue>;
};

export type ParseOptions = {
  /** Long-flag names that are always boolean (never consume a value). */
  booleanFlags?: Iterable<string>;
  /** Short-flag letter → long-flag name, e.g. `{ l: "logger", f: "fifo" }`. */
  shortFlags?: Record<string, string>;
};

export function parseArgs(argv: string[], opts: ParseOptions = {}): ParsedArgs {
  const booleans = new Set(opts.booleanFlags ?? []);
  const shorts = opts.shortFlags ?? {};
  const out: ParsedArgs = {
    command: null,
    positional: [],
    flags: new Map(),
  };

  const setFlag = (
    name: string,
    rawHasInlineValue: boolean,
    inlineValue: string,
    nextToken: string | undefined,
  ): boolean => {
    // Returns true if it consumed `nextToken`.
    if (rawHasInlineValue) {
      out.flags.set(name, inlineValue);
      return false;
    }
    if (booleans.has(name)) {
      out.flags.set(name, true);
      return false;
    }
    if (nextToken !== undefined && !nextToken.startsWith("-")) {
      out.flags.set(name, nextToken);
      return true;
    }
    out.flags.set(name, true);
    return false;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inline = eq === -1 ? "" : a.slice(eq + 1);
      if (setFlag(name, eq !== -1, inline, argv[i + 1])) i++;
      continue;
    }

    if (a.startsWith("-") && a.length > 1) {
      const eq = a.indexOf("=");
      const letter = eq === -1 ? a.slice(1) : a.slice(1, eq);
      const inline = eq === -1 ? "" : a.slice(eq + 1);
      const name = shorts[letter] ?? letter;
      if (setFlag(name, eq !== -1, inline, argv[i + 1])) i++;
      continue;
    }

    if (out.command === null) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }

  return out;
}
