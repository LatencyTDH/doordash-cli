# Install and first run

## Global install

```bash
npm install -g doordash-cli
```

When the npm package is available, that installs both lowercase command names: `doordash-cli` and `dd-cli`.

## Source checkout

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

## Browser prerequisite

Install the matching Playwright Chromium build if `auth-bootstrap` or session recovery needs it.

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

If you are running from a checkout without `npm link`, replace `doordash-cli` with `npm run cli --`.

## Session import behavior

Before launching a new local browser context, direct commands try to import a compatible signed-in DoorDash session from an already-running OpenClaw managed browser.

Probe order:

- `DOORDASH_MANAGED_BROWSER_CDP_URL`
- `OPENCLAW_BROWSER_CDP_URL`
- `OPENCLAW_OPENCLAW_CDP_URL`
- OpenClaw config hints from `~/.openclaw/openclaw.json`
- fallback default `http://127.0.0.1:18800`

## Maintainer verification

Use these when changing install or packaging behavior:

```bash
npm run validate
npm pack --dry-run
npm run smoke:pack
```
