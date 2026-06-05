/**
 * `runCli` — run a Bun CLI entry as a subprocess and capture stdout/stderr/exit.
 * For end-to-end CLI tests (the `dj`/`fifos`/`loggers` binaries), which otherwise
 * each re-implement a `Bun.spawn` + stream-drain + `await exited` dance.
 *
 *   const r = await runCli("src/cli/main.ts", ["status", "--json"], { cwd, env });
 *   expect(r.exitCode).toBe(0);
 *   expect(JSON.parse(r.stdout).ok).toBe(true);
 *
 * `stdin` pipes a string to the child; `timeout` kills it after N ms (recommended
 * for any CLI that could block — a hung child otherwise hangs the whole suite).
 * Consumer-specific bindings (a fixed arg prefix, a `*_DOMAIN` pointing at the
 * test server) stay in a thin wrapper around this.
 */

export type RunCliResult = { stdout: string; stderr: string; exitCode: number };

export type RunCliOptions = {
  cwd?: string;
  /** Extra env vars, merged over `process.env` for the child. */
  env?: Record<string, string>;
  /** String piped to the child's stdin (else stdin is ignored). */
  stdin?: string;
  /** Kill the child after this many ms (else it runs unbounded). */
  timeout?: number;
};

export async function runCli(
  entry: string,
  args: string[] = [],
  opts: RunCliOptions = {},
): Promise<RunCliResult> {
  const proc = Bun.spawn(["bun", entry, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin:
      opts.stdin !== undefined
        ? new TextEncoder().encode(opts.stdin)
        : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const killer =
    opts.timeout !== undefined
      ? setTimeout(() => {
          try {
            proc.kill();
          } catch {}
        }, opts.timeout)
      : undefined;

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (killer) clearTimeout(killer);

  return { stdout, stderr, exitCode };
}
