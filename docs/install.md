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

## Login and session reuse

`doordash-cli login` reuses saved local auth when it is still valid. Otherwise it first tries to import signed-in same-machine Linux Brave/Chrome profile state, then falls back to a discoverable attachable signed-in browser session, and finally opens a temporary Chromium login window it can watch directly. If authentication still is not established, `login` exits non-zero.

`doordash-cli auth-check` can also quietly import same-machine Linux Brave/Chrome profile state or a discoverable attachable signed-in browser session unless `doordash-cli logout` disabled that auto-reuse.

`doordash-cli logout` clears persisted cookies and stored browser state, then keeps passive browser-session reuse disabled until your next explicit `doordash-cli login` attempt.

## Browser-session troubleshooting

Normally you should not need to think about browser plumbing. If `doordash-cli login` opens a temporary Chromium window, finish signing in there and let the CLI save the session. The CLI keeps checking automatically, and if the page already shows you are signed in but the command has not finished yet, press Enter in the terminal to force an immediate recheck.

On Linux, the preferred reuse path is a signed-in local Brave or Google Chrome profile on the same machine, which does not need CDP/remote debugging. If that same-machine profile import is unavailable or not signed in, the next reuse path is an attachable browser automation session.
