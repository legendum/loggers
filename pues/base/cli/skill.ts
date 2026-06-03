/**
 * `installSkill` — copy a CLI's bundled `SKILL.md` into the local agent
 * skill directories so Claude Code and Cursor reach for the CLI by
 * default. Every fleet CLI ships a `<cli> skill` subcommand that does
 * exactly this.
 *
 * The genuinely-shared part is the *destinations* and the copy loop; the
 * *source* is consumer-path-specific (a globally `bun link`-ed CLI runs
 * from `~/.config/<app>/src`, but can also run from any clone). So the
 * consumer resolves candidate source paths — `skillSourceCandidates`
 * builds the usual two — and `installSkill` picks the first that exists
 * and fans it out to `~/.claude/skills/<name>/SKILL.md` and
 * `~/.cursor/skills/<name>/SKILL.md`.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The conventional `SKILL.md` source locations, in priority order:
 *   1. `~/.config/<app>/src/config/SKILL.md` — the `bun link`-ed install
 *   2. `<localRepoRoot>/config/SKILL.md`     — running from a clone
 */
export function skillSourceCandidates(
  app: string,
  localRepoRoot: string,
): string[] {
  const home = process.env.HOME || "~";
  return [
    join(home, ".config", app, "src", "config", "SKILL.md"),
    join(localRepoRoot, "config", "SKILL.md"),
  ];
}

export type InstallSkillOptions = {
  /** Skill directory name under `skills/`. Defaults to the app name. */
  app: string;
  /** Candidate `SKILL.md` paths; first existing one is used. */
  sources: string[];
  /** Override the skill dir name (defaults to `app`). */
  skillName?: string;
};

export function installSkill(opts: InstallSkillOptions): void {
  const source = opts.sources.find(existsSync);
  if (!source) {
    console.error(
      `Could not find config/SKILL.md (looked in: ${opts.sources.join(", ")}).`,
    );
    process.exit(1);
  }

  const home = process.env.HOME || "~";
  const name = opts.skillName ?? opts.app;
  const destinations = [
    join(home, ".claude", "skills", name, "SKILL.md"),
    join(home, ".cursor", "skills", name, "SKILL.md"),
  ];

  for (const dest of destinations) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    console.log(`  ${dest}`);
  }

  console.log(`\nInstalled ${name} skill for Claude Code and Cursor.`);
}
