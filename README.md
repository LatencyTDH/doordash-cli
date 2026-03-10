# doordash-cli

> Unofficial, cart-safe DoorDash for the terminal.

`doordash-cli` is a focused CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, inspect existing orders, and manage a cart with clean JSON output.

It stops before checkout.

- no payment actions
- no checkout or order placement
- no order mutation or cancellation

The goal is a trustworthy terminal workflow for browsing, checking order status, and building a cart without crossing into purchasing.

## Why this exists

- **Cart-safe by design** — browse, read existing orders, and manage a cart; nothing beyond that.
- **Direct API first** — core commands use DoorDash consumer-web GraphQL/HTTP where possible, not brittle DOM clicking.
- **JSON-friendly** — every command is scriptable.
- **Fail-closed** — if a request cannot be validated safely, the CLI refuses instead of guessing.
- **Real CLI ergonomics** — short command name, help text, and man pages included.

## Install

Today the project is meant to run from a local clone.

```bash
npm install
npm run build
npm link
npm run install:man
```

Command names:

- `dd-cli` — preferred
- `doordash-cli`

If `auth-bootstrap` needs a browser binary, install Chromium once:

```bash
npx playwright install chromium
```

Verify the install:

```bash
dd-cli --help
man dd-cli
man doordash-cli
```

## Quick start

```bash
# Reuse an existing session if possible
# (can also import a compatible signed-in browser session)
dd-cli auth-check

# If needed, sign in once and save reusable state
dd-cli auth-bootstrap

# Set the active delivery address
dd-cli set-address --address "350 5th Ave, New York, NY 10118"

# Browse restaurants and menus
dd-cli search --query sushi
dd-cli menu --restaurant-id 1721744
dd-cli item --restaurant-id 1721744 --item-id 546936015

# Inspect existing orders
dd-cli orders --limit 5
dd-cli order --order-id 3f4c6d0e-1234-5678-90ab-cdef12345678

# Build and inspect a cart
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cli cart
```

All commands print JSON.

## More examples

The README keeps the quick-start path tight. For fuller workflows, see [docs/examples.md](docs/examples.md).

That examples guide covers:

- session bootstrap and reset
- search, menu, and item inspection
- read-only order workflows, including `orders`, `orders --active-only`, and `order --order-id ...`
- cart workflows, including `add-to-cart`, `update-cart`, and `cart`
- configurable items with `--options-json`, including supported nested recommended add-ons

## Command guide

### Session

- `auth-check` — verify saved session state and optionally import a compatible signed-in browser session
- `auth-bootstrap` — launch Chromium for a one-time manual sign-in flow and save reusable state
- `auth-clear` — delete saved session state

### Discovery

- `set-address --address <text>` — resolve and persist the active delivery address
- `search --query <text> [--cuisine <name>]` — search restaurants
- `menu --restaurant-id <id>` — fetch a restaurant menu
- `item --restaurant-id <id> --item-id <id>` — fetch one item in detail

### Existing orders

- `orders [--limit <n>] [--active-only]` — list existing orders with status, totals, timestamps, and item summaries
- `order --order-id <id>` — inspect one existing order by internal ID, `orderUuid`, or `deliveryUuid`

### Cart

- `add-to-cart --restaurant-id <id> (--item-id <id> | --item-name <name>)` — add an item to the active cart
- `update-cart --cart-item-id <id> --quantity <n>` — change quantity; use `0` to remove
- `cart` — show the current cart

For configurable items, pass validated `--options-json` selections. See [docs/examples.md#configurable-items](docs/examples.md#configurable-items) for working examples, including supported nested add-ons.

## Safety

The CLI only exposes allowlisted browse, existing-order, and cart commands. It hard-blocks out-of-scope actions such as:

- `checkout`
- `place-order`
- `track-order` (use `orders` / `order`)
- payment-related actions
- order mutation or cancellation actions

Safety is enforced in code, not just in docs:

- unsupported commands hard-fail
- unknown flags are rejected before DoorDash work runs
- direct cart mutations use validated request shapes
- existing-order commands are read-only
- unsupported nested option transports fail closed

## Development

Validate the project with:

```bash
npm run validate
npm pack --dry-run
node dist/bin.js --help
```

## Caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot behavior, or session handling at any time.
- Existing-order support is read-only; checkout and mutation flows are intentionally out of scope.
- In some sessions DoorDash may challenge direct order-history GraphQL fetches. When that happens, the CLI falls back to the consumer-web orders page cache and tells you when results may be partial.
- Review results before trusting them for anything important.

## License

MIT
