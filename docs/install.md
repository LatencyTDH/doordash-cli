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

1. try to reuse an already-signed-in browser session if one is already discoverable
2. if that succeeds, exit immediately without sitting in the 180-second wait path
3. if needed, open DoorDash in your default browser
4. wait only until you finish signing in there and the authenticated session becomes importable
5. import that authenticated session for later direct API calls

Direct commands can also quietly reuse/import a discoverable signed-in browser session when that is already available.

`doordash-cli logout` clears the persisted cookies and stored browser state so follow-up commands start from a logged-out local state.

## Browser-session troubleshooting

Normally you should not need to think about browser plumbing; `doordash-cli login` should just open your normal browser and import the session.

Under the hood, the CLI still needs a discoverable browser connection in order to read that signed-in session. If `login` opens DoorDash but times out without importing anything:

- make sure you finished signing in in the same browser window that opened
- rerun `doordash-cli login`
- if it still cannot import the session, consult the README/browser troubleshooting notes for environment-specific discovery setup
