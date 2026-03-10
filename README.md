# doordash-cli

> Unofficial, cart-safe DoorDash for the terminal.

`doordash-cli` is a focused CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, inspect existing orders, and manage a cart with clean JSON output.

It intentionally stops before checkout.

- no payment actions
- no checkout or order placement
- no order mutation or cancellation

The goal is a trustworthy terminal workflow for browsing, checking order status, and building a cart without crossing into purchasing.

## Why this exists

- **Cart-safe by design** — browse, inspect existing orders, and manage a cart; nothing beyond that.
- **Direct API first** — core commands use DoorDash consumer-web GraphQL/HTTP where possible, not brittle DOM clicking.
- **JSON-friendly** — every command is scriptable.
- **Fail-closed** — if a request cannot be validated safely, the CLI refuses instead of guessing.
- **Better first-run UX** — source installs work immediately after `npm install`, and the package is laid out for eventual global npm installs.

## Install

### From source today

```bash
git clone https://github.com/seans-openclawbot/doordash-cli.git
cd doordash-cli
npm install
npm run cli -- --version
npm run cli -- --help
```

What changed:

- `npm install` now builds automatically via `prepare`
- `npm run cli -- ...` gives you a no-link first-run path
- packaging metadata, docs, license, and man pages are included for npm readiness

Optional shell-wide link during local development:

```bash
npm link
dd-cli --help
npm run install:man
```

### Global npm install

The package is prepared for:

```bash
npm install -g doordash-cli
doordash-cli --version
doordash-cli --help
```

The first public publish still requires maintainer npm auth, but tagged GitHub Releases are now the canonical release channel until issue #12 unlocks npm publication.

### Browser prerequisite

If `auth-bootstrap` or session recovery needs Chromium, install the matching Playwright browser once:

```bash
# local checkout
npm run install:browser

# globally installed package
doordash-cli install-browser
```

### Command names

- `dd-cli` — preferred
- `doordash-cli` — equivalent alias

If you are running from a local checkout without linking, replace `dd-cli` in the examples below with `npm run cli --`.

## First run

```bash
# Install Chromium once if needed
dd-cli install-browser

# Sign in once and save reusable state
dd-cli auth-bootstrap

# Confirm the saved session works
dd-cli auth-check

# Set a delivery address
dd-cli set-address --address "350 5th Ave, New York, NY 10118"

# Start browsing
dd-cli search --query sushi
```

All commands print JSON.

## More docs

- [Install guide](docs/install.md)
- [Examples](docs/examples.md)
- [Release process](docs/releasing.md)
- `man dd-cli`
- `man doordash-cli`

## Command guide

### Session

- `install-browser` — install the matching Playwright Chromium build used by this package
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
npm run smoke:pack
```

## Caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot behavior, or session handling at any time.
- Existing-order support is read-only; checkout and mutation flows are intentionally out of scope.
- In some sessions DoorDash may challenge direct order-history GraphQL fetches. When that happens, the CLI falls back to the consumer-web orders page cache and tells you when results may be partial.
- Review results before trusting them for anything important.

## License

MIT
