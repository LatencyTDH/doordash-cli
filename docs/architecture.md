# Architecture and scope guide

This is a short maintainer/contributor map for `doordash-cli`.

The repo is small on purpose. The architecture tries to keep product surface, safety constraints, and release mechanics obvious enough that a contributor can change one area without accidentally widening the CLI into something riskier.

## High-level design

`doordash-cli` has three main responsibilities:

1. expose a clear terminal-first command surface
2. talk to DoorDash consumer-web APIs for read-only/cart-safe operations
3. keep auth/session handling and release automation predictable

## Major modules

### `src/bin.ts`

Thin executable entrypoint. It should stay boring.

Responsibilities:

- start the CLI
- pass arguments into the main command layer
- return an exit code

### `src/cli.ts`

Owns the public command surface.

Responsibilities:

- parse argv
- normalize flags
- render help/version output
- reject unsupported commands and unknown flags early
- keep legacy/renamed commands pointed at current guidance
- map safe commands onto implementation functions

This file is where the cart-safe boundary is most visible. If a new command is not clearly safe, it should not land here.

### `src/direct-api.ts`

Owns most product logic.

Responsibilities:

- talk to DoorDash consumer-web GraphQL/HTTP endpoints
- validate and shape payloads
- normalize API responses into CLI-friendly output
- manage browser-assisted auth bootstrap paths
- keep add-to-cart/update-cart payloads narrow and explicit

Design rule: if request shaping gets ambiguous, reject it instead of guessing.

### `src/session-storage.ts`

Owns persisted local state.

Responsibilities:

- store auth/session artifacts locally
- keep compatibility with historical storage paths when needed
- separate explicit logout behavior from passive reuse behavior

Session-handling changes deserve extra care because they can quietly affect both security and UX.

## Supporting surface

### `docs/`

User and maintainer docs live here.

Current notable docs:

- `docs/install.md` – install + first-run detail
- `docs/auth-and-session-reuse.md` – auth fallback order, session reuse, and storage details
- `docs/examples.md` – examples and command usage
- `docs/releasing.md` – maintainer release flow
- `docs/architecture.md` – this contributor map

### `scripts/release/`

Release automation helpers and guards.

Current responsibilities include:

- bridging historical release-tag quirks
- validating changelog structure/history
- building release assets
- smoke-testing the release pipeline in a disposable clone

Treat this directory as production infrastructure for the repo, not incidental glue.

## Non-goals

These are deliberate non-goals unless the maintainer explicitly changes project scope:

- checkout / place-order / payment support
- order cancellation or other irreversible post-order mutation
- broad browser-clicking automation as the primary product path
- best-effort payload expansion that weakens cart-safe guarantees
- undocumented command aliases that bypass the reviewed surface area

## Contributor heuristics

When touching this repo, ask:

- Does this change widen the command surface?
- Does it keep unsafe flows impossible or at least fail-closed?
- Does it preserve structured output and shell ergonomics?
- Does it add maintenance burden to release/package/docs workflows?
- Would a new contributor understand the resulting behavior from code + docs alone?

If the answer to any of those is shaky, add tests/docs or narrow the change.
