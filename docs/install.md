# Install and first run

## Install from npm

```bash
npm install -g doordash-cli
```

That installs both lowercase command names: `doordash-cli` and `dd-cli`.

Package page: <https://www.npmjs.com/package/doordash-cli>

## Install from source instead

If you want the latest unreleased work or a local checkout you can edit, install from a checkout:

```bash
git clone https://github.com/LatencyTDH/doordash-cli.git
cd doordash-cli
npm install
npm link
```

After `npm link`, both `doordash-cli` and `dd-cli` resolve globally from your checkout.

## Run from a checkout without linking

```bash
npm run cli -- --help
```

If you stay in checkout mode, replace `doordash-cli` with `npm run cli --` in the examples below.

## Install the bundled runtime if needed

If your environment does not already have Playwright's bundled Chromium runtime installed, install it once:

### Global or linked install

```bash
doordash-cli install-browser
```

### Checkout without linking

```bash
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

## Auth and session reuse

`doordash-cli login`, `doordash-cli auth-check`, and `doordash-cli logout` work together to reuse proven local session state, fall back through supported browser-based recovery paths, and keep logout fail-closed.

Quick summary:

- `doordash-cli login` reuses saved local auth first, then same-machine Chrome/Brave profile state on supported platforms, then attachable signed-in browser sessions, and finally a temporary Chromium login window.
- `doordash-cli auth-check` reports saved-session status and can quietly reuse/import supported browser state unless `doordash-cli logout` disabled that auto-reuse.
- `doordash-cli logout` clears persisted cookies and storage state, then blocks passive browser-session reuse until the next explicit `doordash-cli login`.

For the full behavior, including platform-specific reuse details, session storage locations, `DOORDASH_CLI_SESSION_DIR`, legacy-state migration, and temporary-browser troubleshooting, see [auth-and-session-reuse.md](auth-and-session-reuse.md).
