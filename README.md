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

### Global install

```bash
npm install -g doordash-cli
```

When the npm package is available, that installs both lowercase command names: `doordash-cli` and `dd-cli`.

### Source checkout

Until then:

```bash
git clone https://github.com/seans-openclawbot/doordash-cli.git
cd doordash-cli
npm install
npm link
```

If you prefer to run from a checkout without linking:

```bash
npm run cli -- --help
```

### Browser prerequisite

If Playwright needs Chromium for `auth-bootstrap`:

```bash
doordash-cli install-browser
# or, from a checkout without linking
npm run install:browser
```

## First run

```bash
doordash-cli auth-bootstrap
doordash-cli auth-check
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
doordash-cli search --query sushi
```

If you are running from a checkout without `npm link`, replace `doordash-cli` with `npm run cli --`.

If you already have a compatible signed-in DoorDash browser session available, `auth-check` may reuse it instead of asking you to sign in again.

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
