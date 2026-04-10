# Contributing to doordash-cli

Thanks for helping improve `doordash-cli`.

This project aims to feel like a polished public CLI, but it is deliberately narrow in scope: browse DoorDash, inspect existing orders, and manage a cart from the terminal without crossing into checkout or other unsafe mutations.

If you want the fastest way to contribute successfully, start here.

## Ground rules

- **Keep the CLI cart-safe.** Do not add checkout, payment, order placement, cancellation, tipping, or any other irreversible order mutation.
- **Fail closed.** If a DoorDash payload shape, auth state, or browser reuse path is ambiguous, prefer rejecting it with a helpful error over guessing.
- **Keep output reviewable.** User-facing commands should stay structured, predictable, and friendly to shell/JSON workflows.
- **Preserve release quality.** Packaging, changelog generation, and release automation are part of the product surface.

If you are unsure whether a change fits the project, open an issue or draft PR before doing a larger implementation pass.

## Development setup

### Prerequisites

- Node.js 20 or 22
- npm
- Git

### Clone and install

```bash
git clone https://github.com/LatencyTDH/doordash-cli.git
cd doordash-cli
npm ci
```

If you want to exercise the CLI from your checkout:

```bash
npm run cli -- --help
```

If you want a globally linked local build instead:

```bash
npm link
```

### Optional browser runtime

Some auth flows use Playwright's Chromium bundle when local browser reuse is unavailable.
Install it once if your machine does not already have it:

```bash
npm run install:browser
```

## Project layout

- `src/bin.ts` – CLI entrypoint
- `src/cli.ts` – argument parsing, command routing, help/version behavior, and cart-safe guardrails
- `src/direct-api.ts` – DoorDash consumer-web transport, payload validation, and auth/session bootstrap helpers
- `src/session-storage.ts` – persisted auth/session state and compatibility helpers
- `docs/` – product docs, install guides, release notes, and contributor-facing architecture notes
- `scripts/release/` – release automation helpers and regression guards

For a slightly deeper contributor map, see [docs/architecture.md](docs/architecture.md).

## Validation

Run these before opening or updating a PR:

```bash
npm run validate
```

That covers:

- TypeScript typechecking
- build + test via the repo's canonical `node:test` flow
- changelog history validation

Also run the targeted checks that match your change:

```bash
npm run smoke:pack
npm run release:smoke
```

Use those especially when you touch packaging, docs shipped in the npm tarball, release tooling, changelog handling, or GitHub workflows.

## Coding expectations

### Keep changes narrow and explicit

Small, reviewable PRs land faster than broad cleanup passes. If you are fixing a bug, include the smallest code + test/doc update that proves the behavior.

### Prefer conventional commits in PR titles / squash titles

Release notes are generated from conventional commits on `main`. Good examples:

- `fix: handle missing browser auth state`
- `feat: add read-only order filtering`
- `docs: clarify install-browser behavior`
- `ci: harden release smoke checks`

### Preserve cart-safe boundaries

When changing commands or API payloads, ask:

- Does this expose checkout, payment, or other order mutation?
- Does it broaden payload flexibility in a way that could become unsafe?
- Does it make auth/session reuse less predictable or leak more state?
- Does it still fail closed for unsupported cases?

If the answer is unclear, stop and document the ambiguity in the PR.

## Pull requests

A strong PR for this repo usually includes:

- a concise summary of what changed and why
- linked issue(s) when applicable
- validation notes with the exact commands you ran
- a note on cart-safe or release-safety impact when relevant
- updated docs/tests for user-facing behavior changes

Before requesting review, double-check that your PR:

- stays within project scope
- does not add unsafe commands or payloads
- keeps docs and help text aligned
- leaves the changelog/release flow in a sane state

## Reporting bugs and proposing changes

- Use the issue templates for bug reports and feature requests.
- For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead of opening a detailed public issue.
- If you want to discuss direction before coding, a draft PR with concrete tradeoffs is welcome.

## Release expectations for maintainers and release-adjacent PRs

If your change touches release tooling, changelog generation, packaging, or GitHub Actions, treat the release path as first-class product surface.

That means verifying the relevant commands above and keeping [docs/releasing.md](docs/releasing.md) accurate.
