# Install and first run

## Source checkout

```bash
git clone https://github.com/seans-openclawbot/doordash-cli.git
cd doordash-cli
npm install
npm run cli -- --help
```

From a checkout, run commands with `npm run cli -- ...` unless you link the package locally.

## Optional local link

```bash
npm link
dd-cli --help
```

Linked or packaged installs expose the lowercase command names `dd-cli` and `doordash-cli`.

## Browser prerequisite

Install the matching Playwright Chromium build if `auth-bootstrap` or session recovery needs it.

### From a checkout

```bash
npm run install:browser
```

### After linking or package install

```bash
dd-cli install-browser
```

## First run

From a checkout:

```bash
npm run cli -- auth-bootstrap
npm run cli -- auth-check
npm run cli -- set-address --address "350 5th Ave, New York, NY 10118"
npm run cli -- search --query sushi
```

After `npm link` or package install, replace `npm run cli --` with `dd-cli`.

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
