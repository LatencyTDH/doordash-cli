# AGENTS.md

Repo-local guidance for coding agents working on `doordash-cli`.

## Default working style

- Contributors may use their preferred tools/models; optimize for repo-quality outcomes, not tool-specific rituals.
- Treat this as a serious open-source CLI, not a scratch repo. Favor cohesive UX, tight docs, and scoped changes.
- Prefer the repo's direct API architecture for core behavior; browser automation is bootstrap/recovery glue, not the product.

## Product bar

- Keep the command surface **lowercase-only**. Supported names are `dd-cli` (preferred) and `doordash-cli`.
- Optimize for a polished CLI experience: command names, help text, README, man pages, examples, and package metadata should tell one consistent story.
- User-facing docs should present this as **doordash-cli**. Avoid irrelevant upstream/internal branding leaks (package names, internal project names, etc.) unless technically necessary.

## Scope and safety

- Safe scope: browse/search/menu/item/cart/session flows, plus other clearly **read-only** operations.
- Dangerous flows remain out of scope unless the user explicitly approves them: checkout, payment, order placement, order mutation/cancellation, or anything that could create/modify a real DoorDash order.
- Read-only existing-order work is in scope, but keep the boundary explicit in code and docs (see issue #6 / PR #9 for the current tracking thread).
- Fail closed. If a payload/flow is not directly provable from known DoorDash behavior, reject it instead of guessing.

## Docs discipline

- Keep `README.md` concise and high-signal. Do **not** delete important examples just to make it shorter.
- If examples/tutorial content starts taking over the README, move the bulk to `docs/examples.md` and keep the README focused on install, quick start, safety model, and the core command surface.
- When code changes, update stale docs in the same PR. Do not leave README/help/man pages lagging behind implementation.
- For command-surface changes, sync all of these together:
  - `src/lib.ts` command allowlist / guardrails
  - `src/cli.ts` help text
  - `README.md`
  - `man/dd-cli.1` and `man/doordash-cli.1`
  - relevant tests

## GitHub / planning hygiene

- Use issues for bigger feature, UX, and release work rather than burying the plan in PR comments.
- Current repo threads to respect:
  - **#6**: read-only existing-order tracking
  - **#7**: install / first-run UX polish
  - **#8**: versioning / release process
- Keep PRs scoped. Do **not** mix install/release overhauls into unrelated feature PRs unless truly required.
- Prefer **squash-and-merge** for PRs so `main` stays readable; avoid landing a stack of intermediate WIP/fixup commits from one branch.
- If you need repo-process or contributor guidance changes (like this file), prefer a small focused PR over stuffing it into an unrelated product feature branch.

## Validation before claiming done

- Minimum: run `npm run validate`.
- For CLI/help/package-surface changes, also run the relevant smoke checks, usually:
  - `node dist/bin.js --help`
  - command-specific `--help` or representative command invocations for the changed surface
  - `npm pack --dry-run` when packaging/install/manpage metadata changed
- Do not claim completion without noting exactly what you validated.
