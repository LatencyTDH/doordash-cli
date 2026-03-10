# doordash-cli

> Cart-safe DoorDash from the terminal.

`doordash-cli` is a focused CLI for the parts of DoorDash that make sense in a shell: sign in, set delivery context, search stores, inspect menus and items, and manage the cart. It deliberately stops before checkout, payment, tracking, or order placement.

That small scope is the point. The tool is designed to be useful, scriptable, and hard to misuse.

## Why use it?

- **Cart-safe by design** — no checkout, payment, or order-submission commands.
- **Direct API first** — core flows use DoorDash consumer-web GraphQL/HTTP instead of brittle DOM clicking.
- **JSON output** — every command is easy to pipe into `jq`, scripts, or other tooling.
- **Fast local workflow** — bootstrap a session once, then browse and manage cart state from the shell.
- **Fail-closed behavior** — if the CLI cannot prove a payload safely, it refuses instead of guessing.

## What it does

`doordash-cli` supports:

- auth/session checks
- one-time auth bootstrap in a browser
- clearing saved session state
- setting the active delivery address
- searching for restaurants
- fetching restaurant menus
- fetching item details
- adding items to the cart
- updating cart quantities
- viewing the current cart

It does **not** support:

- checkout
- place-order
- payment actions
- track-order

## Install

### From a local clone

```bash
npm install
npm run build
npm link
npm run install:man
```

That gives you these command names on your `PATH`:

- `dd-cli` — preferred
- `doordash-cli`
- `Dd-cli` — compatibility alias

If Playwright asks for a browser binary during auth bootstrap, install Chromium:

```bash
npx playwright install chromium
```

### Verify the install

```bash
dd-cli --help
man dd-cli
man doordash-cli
```

### Why `npm run install:man`?

The project ships real man pages in `man/`, and the package metadata includes them for standard installs. For a local clone plus `npm link`, `npm run install:man` links those pages into your local manpath so `man dd-cli` works immediately.

On Linux, the default install target is usually:

```text
~/.local/share/man/man1
```

## Quick start

Check whether you already have a reusable session:

```bash
dd-cli auth-check
```

If not, bootstrap one interactively:

```bash
dd-cli auth-bootstrap
```

Set the delivery address:

```bash
dd-cli set-address --address "350 5th Ave, New York, NY 10118"
```

Search for something nearby:

```bash
dd-cli search --query sushi
dd-cli search --query tacos --cuisine mexican
```

Inspect a menu and an item:

```bash
dd-cli menu --restaurant-id 1721744
dd-cli item --restaurant-id 1721744 --item-id 546936015
```

Add an item, then inspect the cart:

```bash
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cli cart
```

All output is JSON.

## Manual pages

The CLI ships with standard man pages:

- `man dd-cli`
- `man doordash-cli`
- `man Dd-cli`

If you are working from a local checkout, run:

```bash
npm run install:man
```

The canonical source files live here:

- `man/dd-cli.1`
- `man/doordash-cli.1`
- `man/Dd-cli.1`

## Command reference

### `auth-check`

Checks whether the saved session appears authenticated.

```bash
dd-cli auth-check
```

This command can also import an already-signed-in compatible managed-browser session when a usable CDP endpoint is available.

### `auth-bootstrap`

Opens Chromium so you can sign in once and save reusable session state.

```bash
dd-cli auth-bootstrap
```

### `auth-clear`

Clears saved session state used by the CLI.

```bash
dd-cli auth-clear
```

### `set-address`

Sets the active delivery address.

```bash
dd-cli set-address --address "350 5th Ave, New York, NY 10118"
```

Behavior:

- reuses an existing saved address when possible
- otherwise resolves the address through DoorDash's address APIs
- persists the resulting delivery context for later commands

### `search`

Searches for restaurants.

```bash
dd-cli search --query sushi
dd-cli search --query tacos --cuisine mexican
```

Flags:

- `--query <text>` — required
- `--cuisine <name>` — optional

### `menu`

Fetches a restaurant menu.

```bash
dd-cli menu --restaurant-id 1721744
```

Flags:

- `--restaurant-id <id>` — required

### `item`

Fetches details for a single item.

```bash
dd-cli item --restaurant-id 1721744 --item-id 546936015
```

Flags:

- `--restaurant-id <id>` — required
- `--item-id <id>` — required

### `add-to-cart`

Adds an item to the cart.

```bash
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
```

You can also look up by item name:

```bash
dd-cli add-to-cart --restaurant-id 1721744 --item-name "Spicy Tuna Roll"
```

Flags:

- `--restaurant-id <id>` — required
- `--item-id <id>` or `--item-name <name>` — one is required
- `--quantity <n>` — optional, defaults to `1`
- `--special-instructions <text>` — optional
- `--options-json <json>` — required for configurable items

#### Configurable items

For items with required option groups, pass `--options-json` as a JSON array of selection objects:

```bash
dd-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-id 546936015 \
  --options-json '[
    {"groupId":"703393388","optionId":"4716032529"},
    {"groupId":"703393389","optionId":"4716042466"}
  ]'
```

Nested recommended add-ons use recursive `children` selections:

```bash
dd-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-id 546936015 \
  --options-json '[
    {"groupId":"703393388","optionId":"4716032529"},
    {"groupId":"703393389","optionId":"4716042466"},
    {
      "groupId":"recommended_option_546935995",
      "optionId":"546936011",
      "children":[
        {"groupId":"780057412","optionId":"4702669757"}
      ]
    }
  ]'
```

Guardrails:

- unknown group IDs are rejected
- unknown option IDs are rejected
- required min/max selection counts are enforced
- duplicate nested selections are rejected
- unsupported nested transport shapes fail closed instead of guessing

### `update-cart`

Updates a cart item's quantity.

```bash
dd-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 1
```

Flags:

- `--cart-item-id <id>` — required
- `--quantity <n>` — required

Set quantity to `0` to remove an item.

### `cart`

Returns the current cart.

```bash
dd-cli cart
```

## Session model

The CLI persists reusable session state between runs so you do not need to sign in every time.

The normal workflow is:

1. run `dd-cli auth-bootstrap` once if needed
2. confirm with `dd-cli auth-check`
3. set an address with `dd-cli set-address ...`
4. browse menus and manage the cart from there

When available, `auth-check` and other direct commands may also import a compatible already-signed-in managed-browser DoorDash session before falling back to a fresh local browser context.

## Safety model

This project is intentionally small and opinionated.

Safety is enforced in code, not just in the README:

- only allowlisted commands are accepted
- known dangerous commands hard-fail immediately
- unknown flags are rejected before any DoorDash work runs
- direct cart mutations use validated request shapes
- unsupported nested option transports fail closed

If you try commands like `checkout` or `place-order`, the CLI blocks them immediately.

## Development

Validate the repo with:

```bash
npm run validate
npm pack --dry-run
node dist/bin.js --help
```

Useful checks while iterating on docs and packaging:

```bash
npm run install:man
man dd-cli
man doordash-cli
```

## Caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot behavior, or session handling at any time.
- Review results before trusting them for anything important.
- Because the tool is intentionally cart-safe, actual ordering still happens outside this CLI.

## License

ISC
