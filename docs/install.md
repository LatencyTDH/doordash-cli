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

That runtime is used for the CLI's local direct-session execution and the temporary Chromium login-window fallback when no reusable browser session is discoverable.

## First run

```bash
doordash-cli login
doordash-cli auth-check
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
doordash-cli search --query sushi
```

## Login and session reuse

`doordash-cli login` follows a browser-first flow:

1. check whether the saved local DoorDash session is already still authenticated
2. if it is, exit immediately without opening a browser
3. otherwise try to import an already-signed-in discoverable browser session
4. if that succeeds, save it for later direct API calls and exit immediately
5. otherwise, if the CLI can watch a reusable attached browser connection, open DoorDash there and wait up to 180 seconds for sign-in to complete
6. if no reusable browser connection is discoverable yet, open a temporary Chromium login window that the CLI can watch directly and wait up to 180 seconds there instead
7. only if that watchable fallback browser cannot be launched does the CLI fall back to opening your default browser and exiting quickly with troubleshooting guidance
8. if authentication still is not established, `login` exits non-zero instead of pretending success

`doordash-cli auth-check` can also quietly reuse/import a discoverable signed-in browser session when that is already available, unless `doordash-cli logout` explicitly disabled that auto-reuse.

`doordash-cli logout` clears the persisted cookies and stored browser state, then disables automatic browser-session reuse until you explicitly run `doordash-cli login` again.

## Browser-session troubleshooting

Normally you should not need to think about browser plumbing; `doordash-cli login` should either reuse a discoverable signed-in browser session or open a temporary Chromium login window it can watch directly.

Under the hood, the CLI still prefers a discoverable browser connection in order to reuse an already-signed-in session without making you sign in again. The current discovery order is:

1. `DOORDASH_ATTACHED_BROWSER_CDP_URLS`
2. `DOORDASH_BROWSER_CDP_URLS`
3. `DOORDASH_ATTACHED_BROWSER_CDP_URL`
4. `DOORDASH_BROWSER_CDP_URL`
5. `DOORDASH_BROWSER_CDP_PORTS`
6. `DOORDASH_BROWSER_CDP_PORT`
7. compatibility env vars `DOORDASH_MANAGED_BROWSER_CDP_URL`, `OPENCLAW_BROWSER_CDP_URL`, and `OPENCLAW_OPENCLAW_CDP_URL`
8. OpenClaw browser config entries from `~/.openclaw/openclaw.json` (top-level browser config, `browser.openclaw`, and profiles `user`, `chrome`, and `openclaw`)
9. localhost defaults `http://127.0.0.1:18792`, `http://127.0.0.1:18800`, and `http://127.0.0.1:9222`

If `login` still cannot import anything:

- first check whether the temporary Chromium login window launched; if it did, finish sign-in there and let the CLI save that session directly
- if you expected existing-browser reuse instead, make sure one of the discovery inputs above actually points at the browser you are using
- when a reusable browser connection is discovered, finish signing in in the same watched browser window that opened
- rerun `doordash-cli login`
- if it still cannot import the session, inspect the browser/session discovery setup rather than waiting through repeated login loops
