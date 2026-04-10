# doordash-cli

> Cart-safe DoorDash CLI for terminal workflows.

`doordash-cli` is an unofficial CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, read existing orders, and manage a cart with JSON output.

It stops before checkout.

## Highlights

- **Cart-safe by design** — browse, inspect existing orders, and manage a cart; no checkout, payment, or order mutation.
- **Browser-first login** — `dd-cli login` reuses saved local auth or an attachable signed-in browser session when possible, and otherwise opens a temporary login window.
- **Direct API first** — auth, discovery, existing-order, and cart commands use DoorDash consumer-web GraphQL/HTTP rather than DOM clicking.
- **JSON-friendly** — every command prints structured output.
- **Fail-closed** — unsupported commands, flags, or unsafe payload shapes are rejected.

## Install

### Install from npm

```bash
npm install -g doordash-cli
```

That installs both lowercase command names: `doordash-cli` and `dd-cli`.

Package page: <https://www.npmjs.com/package/doordash-cli>

For the full install and first-run guide, see [docs/install.md](docs/install.md).

### Install from source instead

If you want the latest unreleased work or a local checkout you can edit, use:

```bash
git clone https://github.com/LatencyTDH/doordash-cli.git
cd doordash-cli
npm install
npm link
```

If you prefer to run from a checkout without linking:

```bash
npm run cli -- --help
```

### Optional runtime bootstrap

If your environment does not already have Playwright's bundled Chromium runtime installed, install it once:

```bash
doordash-cli install-browser
# or, from a checkout without linking
npm run install:browser
```

That runtime is used when the CLI needs a local browser, including the temporary login window fallback.

## First run

```bash
doordash-cli login
doordash-cli auth-check
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
doordash-cli search --query sushi
```

If you are running from a checkout without `npm link`, replace `doordash-cli` with `npm run cli --`.

## Login and session reuse

`login` reuses saved local auth when it is still valid. Otherwise it tries to import a discoverable attachable signed-in browser session. A merely-open Chrome/Brave window is not automatically reusable unless the CLI can actually attach to it. If no attachable session is available, it opens a temporary Chromium login window and saves the session there. If authentication still is not established, `login` exits non-zero.

`auth-check` reports whether the saved state appears logged in and can quietly import a discoverable attachable signed-in browser session unless `logout` disabled that auto-reuse.

`logout` clears persisted cookies and stored browser state, then keeps passive browser-session reuse disabled until your next explicit `dd-cli login` attempt.

If `login` opens a temporary Chromium window, the CLI now keeps checking automatically and also tells you that you can press Enter to force an immediate recheck once the page already shows you are signed in. That restores the old effective manual-completion path without giving up automatic completion when it works. If you expect reuse from another browser instead, make sure it exposes an attachable browser automation session the CLI can actually import; a merely-open browser window is not enough today, even if it is already your main browser.

## Command surface

### Session

- `install-browser`
- `auth-check`
- `login`
- `logout`

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
