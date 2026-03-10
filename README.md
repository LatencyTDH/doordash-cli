# doordash-cart-cli

Minimal local DoorDash CLI with a strict cart-safe surface.

## What it supports

- `auth-check`
- `auth-clear`
- `set-address`
- `search`
- `menu`
- `add-to-cart`
- `cart`

## What it intentionally does **not** support

- checkout
- placing orders
- order tracking
- payment actions

The CLI hard-rejects unknown or dangerous command names before calling any DoorDash automation code.

## Why this design

`@striderlabs/mcp-doordash` already contains workable Playwright automation for DoorDash browsing and cart actions, but its published MCP server also exposes checkout and tracking tools. Instead of running that server directly, this project imports only the safe browser/auth helpers and wraps them in a tiny local CLI with an allowlist.

That gives a stronger safety guarantee than just hiding dangerous commands in help text.

## Install

From this directory:

```bash
npm install
npm run build
npm link
```

If Playwright asks for browser binaries, install them:

```bash
npx playwright install chromium
```

## Usage

```bash
dd auth-check
dd auth-clear
dd set-address --address "123 Main St, New York, NY 10001"
dd search --query sushi
dd search --query tacos --cuisine mexican
dd menu --restaurant-id 123456
dd add-to-cart --restaurant-id 123456 --item-name "Burrito" --quantity 2
dd add-to-cart --restaurant-id 123456 --item-name "Fries" --special-instructions "extra crispy"
dd cart
```

Output is JSON so it is easy to script.

## Authentication / session notes

This wrapper reuses the upstream cookie location:

- `~/.config/striderlabs-mcp-doordash/cookies.json`

`dd auth-check` tells you whether usable cookies appear to be present. This project does **not** automate login or checkout. If you need a valid DoorDash session, do it manually and carefully.

## Security note

This is browser/session automation around the DoorDash website, not an official DoorDash consumer API. DoorDash can change page structure, flows, or account checks at any time, which may break automation. Use cautiously and review behavior before trusting it.

## Implementation details

- Safe command allowlist lives in `src/lib.ts`
- CLI argument parsing and rejection of non-allowlisted commands lives in `src/cli.ts`
- Reused upstream functions:
  - `checkAuth`
  - `setAddress`
  - `searchRestaurants`
  - `getMenu`
  - `addToCart`
  - `getCart`
- Not imported or exposed:
  - `placeOrder`
  - `trackOrder`

## Validation

Run:

```bash
npm run typecheck
npm run build
node --test dist/cli.test.js
node dist/cli.js help
node dist/cli.js checkout
```

Expected:
- typecheck passes
- build passes
- tests pass
- help shows only safe commands
- `checkout` fails immediately as an unsupported/dangerous command
```
