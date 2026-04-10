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

`doordash-cli login` reuses saved local auth when it is still valid. Otherwise it first tries to import signed-in same-machine Chrome/Brave profile state on supported platforms, then falls back to a discoverable attachable signed-in browser session, and finally opens a temporary Chromium login window it can watch directly. If authentication still is not established, `login` exits non-zero.

`doordash-cli auth-check` can also quietly import same-machine Chrome/Brave profile state on supported platforms or a discoverable attachable signed-in browser session unless `doordash-cli logout` disabled that auto-reuse.

`doordash-cli logout` clears persisted cookies and stored browser state, then keeps passive browser-session reuse disabled until your next explicit `doordash-cli login` attempt.

Same-machine profile reuse is preferred before CDP attach or the temporary login window on Linux, macOS, and Windows:

- Linux: import signed-in Brave/Chrome profile cookies directly when they can be decrypted and validated
- macOS: try the installed Brave/Chrome profile directly and keep it only if the CLI can prove authenticated DoorDash consumer state
- Windows: same as macOS, using the installed Brave/Chrome profile directly before slower fallbacks

If profile access fails, the profile is locked, or the CLI cannot prove a signed-in consumer session, it fails closed and moves on to the next fallback.

## Session storage

Reusable session state is stored in a doordash-cli-owned directory:

- Linux / other XDG-like environments: `$XDG_STATE_HOME/doordash-cli`, else `$XDG_CONFIG_HOME/doordash-cli` when only that is set, else `~/.local/state/doordash-cli`
- macOS: `~/Library/Application Support/doordash-cli`
- Windows: `%APPDATA%\\doordash-cli`

Stored files:

- `cookies.json` — imported or saved DoorDash cookies used by the direct API path
- `storage-state.json` — Playwright storage state for direct reuse
- `browser-import-blocked` — written by `logout` so passive browser-session reuse stays off until the next explicit `login`

Override the session directory for automation, CI, containers, or isolated project setups with:

```bash
DOORDASH_CLI_SESSION_DIR=/path/to/doordash-cli-state
```

Legacy migration behavior:

- if the canonical doordash-cli-owned directory is already in use, the CLI keeps using it
- if the canonical directory is empty but legacy state exists under `~/.config/striderlabs-mcp-doordash`, the CLI copies that legacy state forward automatically
- if that copy cannot complete yet, the CLI falls back to the legacy directory instead of breaking existing users

## Browser-session troubleshooting

Normally you should not need to think about browser plumbing. If `doordash-cli login` opens a temporary Chromium window, finish signing in there and let the CLI save the session. The CLI keeps checking automatically, and if the page already shows you are signed in but the command has not finished yet, press Enter in the terminal to force an immediate recheck.

If same-machine profile reuse is unavailable or cannot be proven, the next reuse path is an attachable browser automation session. After that, the CLI falls back to the temporary Chromium window it can watch directly.
