# doordash-cli

> Unofficial, cart-safe DoorDash for the terminal.

`doordash-cli` is a focused CLI for the parts of DoorDash that actually work well in a shell: sign in once, set your delivery context, search restaurants, inspect menus and items, and manage your cart with clean JSON output.

It deliberately stops before checkout.

- no payment actions
- no order placement
- no order tracking
- no “just one more flag” that can turn into an accidental purchase

If you want a trustworthy terminal workflow for browsing and building a cart — without crossing the line into ordering — that is the whole point of this project.

## Why this exists

- **Cart-safe by design** — the command surface is intentionally limited to browse + cart workflows.
- **Direct API first** — core commands use DoorDash consumer-web GraphQL/HTTP, not brittle DOM clicking.
- **JSON-friendly output** — every command is scriptable.
- **Fail-closed behavior** — if the CLI cannot prove a payload safely, it refuses instead of guessing.
- **Real CLI ergonomics** — short command name, help text, and man pages included.

## Install

Today, the project is meant to be used from a local clone.

```bash
npm install
npm run build
npm link
npm run install:man
```

That gives you these command names on your `PATH`:

- `dd-cli` — preferred
- `doordash-cli`

If `auth-bootstrap` needs a browser binary on your machine, install Chromium once:

```bash
npx playwright install chromium
```

Verify everything worked:

```bash
dd-cli --help
man dd-cli
man doordash-cli
```

## Quick start

```bash
# Check whether you already have a reusable session
# (this can also import a compatible signed-in browser session when available)
dd-cli auth-check

# If needed, sign in once and save reusable state
dd-cli auth-bootstrap

# Set the active delivery address
dd-cli set-address --address "350 5th Ave, New York, NY 10118"

# Browse restaurants and menus
dd-cli search --query sushi
dd-cli menu --restaurant-id 1721744
dd-cli item --restaurant-id 1721744 --item-id 546936015

# Add something to the cart and inspect the result
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cli cart
```

All commands print JSON.

## Common examples

Search by query, with or without a cuisine filter:

```bash
dd-cli search --query tacos
dd-cli search --query tacos --cuisine mexican
```

Inspect a restaurant and a specific item:

```bash
dd-cli menu --restaurant-id 1721744
dd-cli item --restaurant-id 1721744 --item-id 546936015
```

Add by item ID or visible item name:

```bash
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cli add-to-cart --restaurant-id 1721744 --item-name "Spicy Tuna Roll"
```

Update quantity or remove an item:

```bash
dd-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 1
dd-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 0
```

Clear saved session state when you want a clean reset:

```bash
dd-cli auth-clear
```

## Command guide

### Session

- `auth-check` — verify the saved session and optionally import a compatible signed-in browser session
- `auth-bootstrap` — launch Chromium for a one-time manual sign-in flow and save reusable state
- `auth-clear` — delete saved session state used by the CLI

### Discovery

- `set-address --address <text>` — resolve and persist the active delivery address
- `search --query <text> [--cuisine <name>]` — search for restaurants
- `menu --restaurant-id <id>` — fetch a restaurant menu
- `item --restaurant-id <id> --item-id <id>` — fetch detailed information for one item

### Cart

- `add-to-cart --restaurant-id <id> (--item-id <id> | --item-name <name>)` — add an item to the active cart
- `update-cart --cart-item-id <id> --quantity <n>` — change quantity; use `0` to remove
- `cart` — show the current cart

## Configurable items

For items with required option groups, pass `--options-json` with explicit selections:

```bash
dd-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-id 546936015 \
  --options-json '[
    {"groupId":"703393388","optionId":"4716032529"},
    {"groupId":"703393389","optionId":"4716042466"}
  ]'
```

Some standalone recommended add-ons that open a proven nested cursor step are also supported through recursive `children` selections:

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

## Safety model

This project is intentionally narrow.

The CLI accepts only an allowlisted set of browse/cart commands and blocks known dangerous commands immediately, including:

- `checkout`
- `place-order`
- `track-order`
- payment-related actions

Safety is enforced in code, not just in the README:

- unsupported commands hard-fail
- unknown flags are rejected before DoorDash work runs
- direct cart mutations use validated request shapes
- unsupported nested option transports fail closed

## Session model

The CLI persists reusable session state between runs, so you do not need to sign in every time.

Typical workflow:

1. run `dd-cli auth-check`
2. if needed, run `dd-cli auth-bootstrap`
3. set the address with `dd-cli set-address ...`
4. browse menus and manage the cart from there

When available, direct commands can also import a compatible already-signed-in managed-browser DoorDash session before falling back to a local browser bootstrap.

## Manual pages

The repo ships manual pages for both supported command names:

- `man dd-cli`
- `man doordash-cli`

If you are working from a local checkout, install them with:

```bash
npm run install:man
```

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
- Review results before trusting them for anything important.
- Because the tool is intentionally cart-safe, actual ordering still happens outside this CLI.

## License

ISC
