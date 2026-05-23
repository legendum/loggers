import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YAML } from "bun";

const CLI_PATH = join(process.cwd(), "src/cli/main.ts");
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const decoder = new TextDecoder();

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runCli(
  args: string[],
  env: Record<string, string>,
  cwd = process.cwd(),
): CliResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, "run", CLI_PATH, ...args],
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: decoder.decode(proc.stdout),
    stderr: decoder.decode(proc.stderr),
  };
}

describe("loggers CLI alias command", () => {
  test("writes alias to $HOME/.config/loggers/loggers.yaml", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    try {
      const result = runCli(["alias", "app", ULID], {
        HOME: home,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("saved alias 'app'");
      const configPath = join(home, ".config", "loggers", "loggers.yaml");
      expect(existsSync(configPath)).toBe(true);
      const parsed = YAML.parse(readFileSync(configPath, "utf-8")) as {
        loggers?: { app?: { ulid?: string; level?: string } };
      };
      expect(parsed.loggers?.app?.ulid).toBe(ULID);
      expect(parsed.loggers?.app?.level).toBe("info");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("resolves -l <name> through global alias map", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    try {
      const setAlias = runCli(["alias", "app", ULID], {
        HOME: home,
      });
      expect(setAlias.exitCode).toBe(0);

      const result = runCli(["-l", "app", "noop"], {
        HOME: home,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Unknown command: noop");
      expect(result.stderr).not.toContain("unknown logger 'app'");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("prints clear error when alias is missing", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    try {
      const result = runCli(["-l", "missing", "noop"], {
        HOME: home,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("unknown logger 'missing'");
      expect(result.stderr).toContain("loggers alias <name> <ulid>");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("accepts alias shortcut with explicit level", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    try {
      const result = runCli(["alias", "app", ULID, "warn"], {
        HOME: home,
      });
      expect(result.exitCode).toBe(0);
      const parsed = YAML.parse(
        readFileSync(join(home, ".config", "loggers", "loggers.yaml"), "utf-8"),
      ) as { loggers?: { app?: { level?: string } } };
      expect(parsed.loggers?.app?.level).toBe("warn");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("updates level via loggers level <name> <level>", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    try {
      const setAlias = runCli(["alias", "app", ULID], { HOME: home });
      expect(setAlias.exitCode).toBe(0);
      const setLevel = runCli(["level", "app", "error"], { HOME: home });
      expect(setLevel.exitCode).toBe(0);
      const parsed = YAML.parse(
        readFileSync(join(home, ".config", "loggers", "loggers.yaml"), "utf-8"),
      ) as { loggers?: { app?: { level?: string } } };
      expect(parsed.loggers?.app?.level).toBe("error");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("uses loggers.dev alias as implicit global fallback", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    const configDir = join(home, ".config", "loggers");
    mkdirSync(configDir, { recursive: true });
    try {
      writeFileSync(
        join(configDir, "loggers.yaml"),
        `loggers:\n  loggers.dev:\n    ulid: ${ULID}\n`,
        "utf-8",
      );
      const result = runCli(["noop"], {
        HOME: home,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Unknown command: noop");
      expect(result.stderr).not.toContain("LOGGERS_ULID not set");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("resolves target via LOGGERS_NAME in project .env", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "loggers-cli-alias-"));
    const home = join(sandbox, "home");
    const project = join(sandbox, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    try {
      const setAlias = runCli(["alias", "app", ULID], { HOME: home }, project);
      expect(setAlias.exitCode).toBe(0);
      writeFileSync(join(project, ".env"), "LOGGERS_NAME=app\n", "utf-8");
      const result = runCli(["noop"], { HOME: home }, project);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Unknown command: noop");
      expect(result.stderr).not.toContain("LOGGERS_ULID not set");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
