# doordash-cli

> Cart-safe DoorDash CLI for terminal workflows.

`doordash-cli` is an unofficial CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, read existing orders, and manage a cart with JSON output.

It stops before checkout.

## Highlights

- **Cart-safe by design** — browse, inspect existing orders, and manage a cart; no checkout, payment, or order mutation.
- **Browser-first login** — `dd-cli login` first reuses saved local auth when it is still valid, then tries to import a discoverable signed-in browser session, and only opens/waits on DoorDash in your normal browser when needed.
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

That runtime is used for the CLI's local direct-session execution and the temporary Chromium login-window fallback when no reusable browser session is discoverable.

## First run

```bash
doordash-cli login
doordash-cli auth-check
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
doordash-cli search --query sushi
```

If you are running from a checkout without `npm link`, replace `doordash-cli` with `npm run cli --`.

## Login and session reuse

### `login`

`login` follows a browser-first flow:

1. check whether the saved local DoorDash session is already still authenticated
2. if it is, exit immediately without opening a browser
3. otherwise try to import an already-signed-in discoverable browser session
4. if that succeeds, save it for later direct API calls and exit immediately
5. otherwise, if the CLI can watch a reusable attached browser connection, open DoorDash there and wait up to 180 seconds for sign-in to complete
6. if no reusable browser connection is discoverable yet, open a temporary Chromium login window that the CLI can watch directly and wait up to 180 seconds there instead
7. only if that watchable fallback browser cannot be launched does the CLI fall back to opening your default browser and exiting quickly with troubleshooting guidance
8. if authentication still is not established, `login` exits non-zero instead of pretending success

### `auth-check`

`auth-check` performs a direct `consumer` query and reports whether the saved state appears logged in, plus the default address if DoorDash returns one.

When a reusable signed-in browser session is already discoverable, `auth-check` can quietly import it instead of making you sign in again, unless `logout` explicitly disabled that auto-reuse.

### `logout`

`logout` clears the persisted cookies and stored browser state that power later direct API calls, then blocks automatic browser-session reuse until you explicitly run `dd-cli login` again. That keeps `logout` from being immediately undone by a still-signed-in browser window.

### Browser-session troubleshooting

The happy path is `dd-cli login` either reusing an already-discoverable signed-in browser session or opening a temporary Chromium login window that the CLI can watch directly.

Under the hood, the CLI still prefers a discoverable browser connection when one is available, because that lets it import an existing signed-in session without making you sign in again. If it cannot find one, it now falls back to a watchable Chromium login window instead of immediately giving up. See the install guide for the exact discovery inputs it checks (environment variables, OpenClaw browser config, and default localhost CDP ports) when you want attached-browser reuse to work too.

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
