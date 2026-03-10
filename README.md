# doordash-cart-cli

Local DoorDash CLI with a deliberately small, cart-safe command surface.

## Safety model

This project is intentionally limited to browsing and cart management:

- `auth-check`
- `auth-clear`
- `set-address`
- `search`
- `menu`
- `add-to-cart`
- `cart`

It does **not** expose or call:

- checkout
- place-order
- track-order
- payment actions

The CLI enforces this in code, not just docs:

- only allowlisted commands are accepted
- known dangerous commands return a hard failure immediately
- unknown flags are rejected before any DoorDash browser automation runs

## Why this exists

`@striderlabs/mcp-doordash` contains useful Playwright automation for browsing DoorDash and managing cart state, but its broader server surface also includes order-placement and tracking functions. This wrapper reuses only the safe pieces and keeps the interface local and constrained.

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

You can run the compiled CLI directly:

```bash
node dist/cli.js --help
```

Or after `npm link`, use one of the installed commands:

```bash
dd-cart --help
doordash-cart --help
```

Examples:

```bash
dd-cart auth-check
dd-cart auth-clear
dd-cart set-address --address "123 Main St, New York, NY 10001"
dd-cart search --query sushi
dd-cart search --query tacos --cuisine mexican
dd-cart menu --restaurant-id 123456
dd-cart add-to-cart --restaurant-id 123456 --item-name "Burrito" --quantity 2
dd-cart add-to-cart --restaurant-id 123456 --item-name "Fries" --special-instructions "extra crispy"
dd-cart cart
```

Output is JSON so it can be scripted easily.

## Authentication / session notes

This wrapper reuses the upstream cookie location:

- `~/.config/striderlabs-mcp-doordash/cookies.json`

`auth-check` tells you whether usable cookies appear to be present. This project does **not** automate login or checkout. If you need a valid DoorDash session, log in manually and manage cookies carefully.

## Security caveats

- This is browser automation against the DoorDash website, not an official DoorDash consumer API.
- DoorDash can change flows, markup, or anti-automation checks at any time.
- Review results before trusting them for anything important.
- Because this is intentionally cart-safe, actually placing an order still requires a manual step outside this CLI.

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
- unknown flags fail before any browser automation runs

## Implementation notes

- Safe command allowlist and flag validation live in `src/lib.ts`
- CLI argument parsing and output handling live in `src/cli.ts`
- Tests in `src/cli.test.ts` cover both allowlist logic and CLI guardrails
- Reused upstream functions:
  - `checkAuth`
  - `setAddress`
  - `searchRestaurants`
  - `getMenu`
  - `addToCart`
  - `getCart`
- Intentionally not imported or exposed:
  - `placeOrder`
  - `trackOrder`
