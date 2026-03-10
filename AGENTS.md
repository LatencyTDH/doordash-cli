# AGENTS.md

Repo-local guidance for contributors working on `doordash-cli`.

## Product bar

- Treat this as a serious OSS CLI. Keep command names, help text, README, man pages, examples, package metadata, and output telling one coherent story.
- Keep the command surface **lowercase-only**. Supported bins are `dd-cli` and `doordash-cli`; user-facing docs should normally call it **doordash-cli**.
- Prefer the direct API path for core behavior. Browser automation is bootstrap/recovery glue, not the product.

## Scope and safety

- Protect the cart-safe boundary. Browse/search/menu/item/cart/session flows are the default safe surface.
- Do not add checkout, payment, order placement, cancellation, or other live-order mutations without explicit approval.
- Fail closed. If a payload, nested option path, or workflow is not clearly proven from known DoorDash behavior, reject it instead of guessing.

## Docs and examples

- Keep `README.md` concise and high-signal, but do **not** delete important examples just to make it shorter.
- If examples/tutorial content grows, move the bulk to `docs/examples.md` and keep the README focused on install, quick start, safety model, and the core command surface.
- Avoid irrelevant upstream or internal branding leaks unless technically necessary.

## Change scope and sync

- Keep PRs scoped. Do not mix unrelated install, release, or feature work into one branch unless it is truly required.
- If you change commands, flags, or behavior, update the implementation, help text, README, man pages, and relevant tests in the same PR.
- For command-surface changes, usually sync `src/lib.ts`, `src/cli.ts`, `README.md`, `man/dd-cli.1`, `man/doordash-cli.1`, and affected tests.
- Release automation depends on conventional-commit squash titles on `main`. Keep PR titles and final squash titles in forms like `feat: ...`, `fix: ...`, or `feat!: ...` so versioning and release notes stay clean.

## Validation and merge

- Minimum check: `npm run validate`.
- For CLI/help/package-surface changes, also run `node dist/bin.js --help` plus targeted smoke checks; use `npm pack --dry-run` when packaging/install/manpage metadata changes.
- Note exactly what you validated, and prefer squash-and-merge.
