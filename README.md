# doordash-cli

> Cart-safe DoorDash CLI for terminal workflows.

`doordash-cli` is an unofficial CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, read existing orders, and manage a cart with JSON output.

It stops before checkout.

## Highlights

- **Cart-safe by design** — browse, inspect existing orders, and manage a cart; no checkout, payment, or order mutation.
- **Direct API first** — auth, discovery, existing-order, and cart commands use DoorDash consumer-web GraphQL/HTTP rather than DOM clicking.
- **JSON-friendly** — every command prints structured output.
- **Fail-closed** — unsupported commands, flags, or unsafe payload shapes are rejected.

## Install

Install from a checkout:

```bash
git clone https://github.com/seans-openclawbot/doordash-cli.git
cd doordash-cli
npm install
npm run cli -- --help
```

Optional local link:

```bash
npm link
dd-cli --help
```

If Playwright needs Chromium for `auth-bootstrap` or session recovery:

```bash
npm run install:browser
# or, after linking
dd-cli install-browser
```

Installed command names are lowercase only: `dd-cli` and `doordash-cli`.

## First run

```bash
dd-cli auth-bootstrap
dd-cli auth-check
dd-cli set-address --address "350 5th Ave, New York, NY 10118"
dd-cli search --query sushi
```

If you are running from a checkout without `npm link`, replace `dd-cli` with `npm run cli --`.

`auth-check` and other direct commands can import a compatible signed-in OpenClaw managed-browser session when one is available.

## Command surface

### Session

- `install-browser`
- `auth-check`
- `auth-bootstrap`
- `auth-clear`

### Discovery

- `set-address --address <text>`
- `search --query <text> [--cuisine <name>]`
- `menu --restaurant-id <id>`
- `item --restaurant-id <id> --item-id <id>`

### Existing orders

- `orders [--limit <n>] [--active-only]`
- `order --order-id <id>`

### Cart

- `add-to-cart --restaurant-id <id> (--item-id <id> | --item-name <name>)`
- `update-cart --cart-item-id <id> --quantity <n>`
- `cart`

For configurable items and working command examples, see [docs/examples.md](docs/examples.md).

## Safety

The CLI allowlists browse, existing-order, and cart commands. It hard-blocks:

- `checkout`
- `place-order`
- payment actions
- order mutation or cancellation actions

Safety is enforced in code:

- unsupported commands hard-fail
- unknown flags are rejected before DoorDash work runs
- direct cart mutations use validated request shapes
- unsupported nested option transports fail closed

## Docs

- [Install guide](docs/install.md)
- [Examples](docs/examples.md)
- [Release process](docs/releasing.md)
- `man dd-cli`
- `man doordash-cli`

## Caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot behavior, or session handling at any time.
- Review results before trusting them for anything important.

## License

MIT
