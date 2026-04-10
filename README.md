# doordash-cli

> Cart-safe DoorDash CLI for terminal workflows.

`doordash-cli` is an unofficial CLI for the parts of DoorDash that work well in a shell: sign in once, set a delivery address, search restaurants, inspect menus and items, read existing orders, and manage a cart with JSON output.

It stops before checkout.

## Highlights

- **Cart-safe by design** — browse, inspect existing orders, and manage a cart; no checkout, payment, or order mutation.
- **Browser-first login** — `dd-cli login` opens DoorDash in your normal browser and imports that signed-in session for later direct API calls when it can discover the browser session automatically.
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

That runtime is used for the CLI's local direct-session execution. It is not a separate browser fallback for the login UX.

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

1. try to reuse an already-signed-in browser session if one is already discoverable
2. if that succeeds, exit immediately without entering the 180-second wait path
3. if needed, open DoorDash in your default browser
4. wait only until you finish signing in there and the authenticated session becomes importable
5. import that authenticated session for later direct API calls

There is no separate managed-Chromium login fallback.

### `auth-check`

`auth-check` performs a direct `consumer` query and reports whether the saved state appears logged in, plus the default address if DoorDash returns one.

When a reusable signed-in browser session is already discoverable, `auth-check` can quietly import it instead of making you sign in again.

### `logout`

`logout` clears the persisted cookies and stored browser state that power later direct API calls, so follow-up commands start from a logged-out local state.

### Browser-session troubleshooting

The happy path is `dd-cli login` opening your normal browser and importing the session automatically.

Under the hood, the CLI still needs a discoverable browser connection to read that signed-in session. In most setups this should be handled automatically by the browser/session discovery logic. If `login` opens DoorDash but times out without importing a session, see the install guide for the browser-session troubleshooting notes and rerun `dd-cli login`.

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
