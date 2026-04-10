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

That runtime is used for the CLI's local direct-session execution. It is not a separate browser fallback for the login flow.

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
5. otherwise open DoorDash in your default browser
6. if the CLI can actually watch a reusable browser connection, wait up to 180 seconds for sign-in to complete and then import that session
7. if no reusable browser connection is discoverable yet, do only a brief grace check and then exit quickly with troubleshooting guidance instead of burning the full timeout

`doordash-cli auth-check` can also quietly reuse/import a discoverable signed-in browser session when that is already available, unless `doordash-cli logout` explicitly disabled that auto-reuse.

`doordash-cli logout` clears the persisted cookies and stored browser state, then disables automatic browser-session reuse until you explicitly run `doordash-cli login` again.

## Browser-session troubleshooting

Normally you should not need to think about browser plumbing; `doordash-cli login` should just open your normal browser and import the session.

Under the hood, the CLI still needs a discoverable browser connection in order to read that signed-in session. The current discovery order is:

1. `DOORDASH_ATTACHED_BROWSER_CDP_URLS`
2. `DOORDASH_BROWSER_CDP_URLS`
3. `DOORDASH_ATTACHED_BROWSER_CDP_URL`
4. `DOORDASH_BROWSER_CDP_URL`
5. `DOORDASH_BROWSER_CDP_PORTS`
6. `DOORDASH_BROWSER_CDP_PORT`
7. compatibility env vars `DOORDASH_MANAGED_BROWSER_CDP_URL`, `OPENCLAW_BROWSER_CDP_URL`, and `OPENCLAW_OPENCLAW_CDP_URL`
8. OpenClaw browser config entries from `~/.openclaw/openclaw.json` (top-level browser config, `browser.openclaw`, and profiles `user`, `chrome`, and `openclaw`)
9. localhost defaults `http://127.0.0.1:18792`, `http://127.0.0.1:18800`, and `http://127.0.0.1:9222`

If `login` opens DoorDash but cannot import anything:

- make sure you finished signing in in the same browser window that opened
- make sure one of the discovery inputs above actually points at the browser you are using
- rerun `doordash-cli login`
- if it still cannot import the session, inspect the browser/session discovery setup rather than waiting through repeated login loops
