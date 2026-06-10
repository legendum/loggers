---
name: pues-release
description: Cut a Pues release — bump package.json, log the change in docs/TAGS.md, commit as chore(release), and push a v-prefixed git tag. Use when tagging a new Pues version so consumers can pin which version they vendored.
---
# Pues Release (tagging)

## Purpose
Pues is a *peer source* that consumers vendor from `../pues`. A git tag is how a
consumer records which version of Pues it copied (see `docs/AI_PLAN.md` — "cut a
pues git tag at the end of each phase"). This skill is the checklist for cutting
one consistently.

## When to tag
Tag when something landed that a consumer would want to pin or adopt: a new
`base/<part>`, a behavior change in an existing part, or a meaningful fix.
Routine internal refactors that don't change the vendored surface don't need a
tag.

## Versioning
- **Tags are `v`-prefixed**: `v0.20.0` (the whole history uses this — match it).
- **`package.json` `version` must equal the latest tag** *without* the `v`
  (tag `v0.20.0` ⇒ `"version": "0.20.0"`). Keeping them in lockstep is the rule;
  if they've drifted, this is the moment to realign — set `version` to the tag
  you're cutting, not to whatever stale number is there.
- Semver intent: **minor** (`0.X.0`) for a new part or additive surface;
  **patch** (`0.X.Y`) for fixes/tweaks to an existing part.

## Steps
1. **Pick the version** — next minor for a new part, next patch for a fix.
   Check the highest existing tag: `git tag | sort -V | tail -1`.
2. **Bump `package.json`** `version` to match (no `v`).
3. **Log it in `docs/TAGS.md`** — a new top entry (newest first): the version,
   a one-line scope, and 2–4 bullets of what changed. This is the human-readable
   changelog; `git log` is the full record.
4. **`bun run smoke` must pass** (lint + test + tsc) before you commit or push.
   A red release tag is worse than a late one — never tag a version that doesn't
   pass smoke. Fix the failure first, then continue.
5. **Commit** with the house convention:
   `chore(release): vX.Y.Z — <short scope>` (e.g. `… — base/a11y`). Fold the
   feature/doc changes into this commit, or land them first and let the release
   commit carry just the bump + `TAGS.md` — either is fine; the repo has done
   both. End the body with the `Co-Authored-By:` trailer.
6. **Tag the release commit**: `git tag vX.Y.Z`.
7. **Push commit + tag**: `git push && git push --tags` (or
   `git push origin main vX.Y.Z`).

## After tagging
A consumer adopts the new version by pointing `../pues` at the tag (or a later
SHA), then `bun run pues` to re-vendor, and committing the updated `pues/` tree.
You don't do that here — it happens in the consumer repo.

## Checklist
- [ ] `bun run smoke` passes (lint + test + tsc) — never tag a red build.
- [ ] `package.json` `version` == the tag (minus `v`).
- [ ] `docs/TAGS.md` has a new top entry for this version.
- [ ] Commit is `chore(release): vX.Y.Z — <scope>` with the Co-Authored-By trailer.
- [ ] `git tag vX.Y.Z` points at that commit.
- [ ] Both the commit and the tag are pushed.
