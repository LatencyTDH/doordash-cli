# doordash-cart-cli

Local DoorDash CLI with a deliberately small, cart-safe command surface.

## Safety model

This project is intentionally limited to browsing and cart management:

- `auth-check`
- `auth-bootstrap`
- `auth-clear`
- `set-address`
- `search`
- `menu`
- `item`
- `add-to-cart`
- `update-cart`
- `cart`

It does **not** expose or call:

- checkout
- place-order
- track-order
- payment actions

The CLI enforces this in code, not just docs:

- only allowlisted commands are accepted
- known dangerous commands return a hard failure immediately
- unknown flags are rejected before any DoorDash work runs

## Direct API approach

The primary path is now DoorDash consumer-web GraphQL/HTTP, not DOM clicking:

- `auth-check`, `search`, `menu`, `item`, `cart`, `add-to-cart`, and `update-cart` use direct request builders + parsers
- browser usage is limited to:
  - one-time manual session bootstrap via `auth-bootstrap`
  - the still-fallback `set-address` flow

This keeps the core integration focused on stable request/response shapes instead of fragile page selectors.

## Install

From this directory:

```bash
npm install
npm run build
npm link
```

If Playwright asks for browser binaries, install Chromium:

```bash
npx playwright install chromium
```

## Usage

Run the compiled CLI directly:

```bash
node dist/cli.js --help
```

Or after `npm link`:

```bash
dd-cart --help
doordash-cart --help
```

`dd-cart` is used instead of bare `dd` so the package does not collide with the Unix `dd` utility.

Examples:

```bash
dd-cart auth-check
dd-cart auth-bootstrap
dd-cart auth-clear
dd-cart set-address --address "123 Main St, New York, NY 10001"
dd-cart search --query sushi
dd-cart search --query tacos --cuisine mexican
dd-cart menu --restaurant-id 1721744
dd-cart item --restaurant-id 1721744 --item-id 546936015
dd-cart add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cart add-to-cart --restaurant-id 1721744 --item-name "Sushi premium"
dd-cart update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 1
dd-cart cart
```

Output is JSON so it can be scripted easily.

## Session / auth expectations

The CLI keeps session material under the same config root as the upstream project:

- cookies: `~/.config/striderlabs-mcp-doordash/cookies.json`
- direct-session browser state: `~/.config/striderlabs-mcp-doordash/storage-state.json`

### Recommended bootstrap

Use `auth-bootstrap` once when you need a fresh reusable session:

```bash
dd-cart auth-bootstrap
```

That opens Chromium, lets you sign in manually, then saves the browser state for later direct API calls.

### `auth-check`

`auth-check` performs a direct `consumer` query and reports whether the saved state appears logged in, plus the default address if DoorDash returns one.

## Current scope / gaps

### Implemented direct support

- auth/session check
- search
- menu fetch
- item detail fetch
- cart read
- add-to-cart for quick-add items with **no required option groups**
- update-cart by cart item id

### Not implemented / intentionally limited

- checkout / order placement / tracking / payment
- direct address persistence write
- arbitrary item-option selection for complex items

If an item has required option groups, `add-to-cart` fails closed with a clear message instead of guessing selections.

## `set-address` note

`set-address` is still the exception: it remains browser-assisted. I did **not** switch it to a direct persistence write because the persistence path was not isolated cleanly enough yet.

## Security caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot checks, or session behavior at any time.
- Review results before trusting them for anything important.
- Because this tool is intentionally cart-safe, actual ordering still requires a manual step outside this CLI.

## Development

Validation commands:

```bash
npm run typecheck
npm run build
npm test
node dist/cli.js --help
node dist/cli.js checkout
node dist/cli.js cart --payment-method visa
```

Expected behavior:

- typecheck passes
- build passes
- tests pass
- help shows only the safe command surface
- `checkout` fails immediately as blocked
- unknown flags fail before any DoorDash work runs

## Implementation notes

- Direct request builders, parsers, and browser-backed session transport live in `src/direct-api.ts`
- Safe command allowlist and command dispatch live in `src/lib.ts`
- CLI parsing/output lives in `src/cli.ts`
- Tests cover both allowlist guardrails and direct request-shape helpers
