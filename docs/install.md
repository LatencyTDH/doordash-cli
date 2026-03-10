# Install and first-run guide

## Recommended paths

## 1) From a local checkout

Use this today if you are working from source before the first public npm publish.

```bash
git clone https://github.com/seans-openclawbot/doordash-cli.git
cd doordash-cli
npm install
npm run cli -- --version
npm run cli -- --help
```

What changed for install UX:

- `npm install` now runs the build automatically via `prepare`
- you no longer need a separate `npm run build` before the CLI is usable
- `npm run cli -- ...` gives you a no-link first-run path

Optional shell-wide link during local development:

```bash
npm link
doordash-cli --help
```

## 2) Global npm install

The package is prepared for global installation as soon as a maintainer publishes the first release:

```bash
npm install -g doordash-cli
doordash-cli --version
doordash-cli --help
```

Current blocker for a live public install: a maintainer must be logged in to npm on the release machine and publish the first version.

## Browser prerequisite

This project depends on Playwright's Chromium browser for session bootstrap and some recovery flows.

If Chromium is not installed yet:

### Local checkout

```bash
npm run install:browser
```

### Global install

```bash
doordash-cli install-browser
```

## First successful command

If you installed from source, replace `doordash-cli` with `npm run cli --`.

### Install Chromium if needed

```bash
doordash-cli install-browser
```

This uses the Playwright CLI bundled with the package, so the downloaded browser revision matches the installed `doordash-cli` version.

### Bootstrap a reusable session

```bash
doordash-cli auth-bootstrap
```

That opens Chromium and lets you sign in manually. The CLI then stores reusable session state under `~/.config/striderlabs-mcp-doordash/`.

### Verify the saved session

```bash
doordash-cli auth-check
```

Expected result: JSON confirming whether DoorDash considers the saved session logged in, and often the default address if DoorDash returns one.

### Quick browse smoke test

```bash
doordash-cli search --query sushi
```

## Session import behavior

Before starting a new local browser context, direct commands try to import a signed-in DoorDash session from an already-running OpenClaw managed browser.

Probe order:

- `DOORDASH_MANAGED_BROWSER_CDP_URL`
- `OPENCLAW_BROWSER_CDP_URL`
- `OPENCLAW_OPENCLAW_CDP_URL`
- OpenClaw config hints from `~/.openclaw/openclaw.json`
- fallback default `http://127.0.0.1:18800`

## Verification commands for maintainers

```bash
npm run validate
npm pack --dry-run
npm run smoke:pack
```

What they cover:

- TypeScript + tests
- npm package contents
- real tarball install into a clean temporary prefix
- post-pack CLI verification with `doordash-cli --version` and `doordash-cli --help`
