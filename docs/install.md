# Install and first run

## Preferred global install

```bash
npm install -g doordash-cli
```

That is the long-term default install path. Once npm publication is live, it installs both lowercase command names: `doordash-cli` and `dd-cli`.

## Install from source today

Before npm publication is enabled, install from a checkout:

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

## Install the browser once

If you plan to use `auth-bootstrap`, install the matching Playwright Chromium build:

### Global or linked install

```bash
doordash-cli install-browser
```

### Checkout without linking

```bash
npm run install:browser
```

## First run

```bash
doordash-cli auth-bootstrap
doordash-cli auth-check
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
doordash-cli search --query sushi
```

## Session reuse

If you already have a compatible signed-in DoorDash browser session available, direct commands may reuse it instead of opening a fresh browser context.

If not, run `doordash-cli auth-bootstrap` once to save reusable state for later commands.
