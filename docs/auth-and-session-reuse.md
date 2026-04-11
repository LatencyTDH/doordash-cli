# Auth and session reuse

This page covers how `doordash-cli` signs in, reuses saved state, stores session artifacts, and intentionally stays fail-closed after logout.

## What the session commands do

- `doordash-cli login` reuses saved local auth when it is still valid. Otherwise it first tries same-machine Chrome/Brave profile reuse on supported platforms, then a discoverable attachable signed-in browser session, and finally a temporary Chromium login window it can watch directly.
- `doordash-cli auth-check` reports whether the saved state appears logged in and can quietly reuse/import supported browser state unless `doordash-cli logout` disabled that auto-reuse.
- `doordash-cli logout` clears persisted cookies and stored browser state, then keeps passive browser-session reuse disabled until your next explicit `doordash-cli login` attempt.

If authentication still is not established after the available reuse and bootstrap paths run, `login` exits non-zero.

## Reuse order and fallbacks

The CLI prefers the fastest local proof first and only escalates when it cannot prove authenticated consumer state.

1. Reuse saved local auth if it is still valid.
2. Reuse same-machine Chrome/Brave profile state on supported platforms.
3. Reuse a discoverable attachable signed-in browser session when available.
4. Open a temporary Chromium login window that the CLI can watch directly.

If a reuse path cannot be proven, the CLI fails closed and moves to the next fallback instead of assuming the session is usable.

## Same-machine browser profile reuse

Same-machine Chrome/Brave reuse is preferred before CDP attach or the temporary login window on Linux, macOS, and Windows.

- Linux: import signed-in Brave/Chrome profile cookies directly when they can be decrypted and validated.
- macOS: try the installed Brave/Chrome profile directly and keep it only if the CLI can prove authenticated DoorDash consumer state.
- Windows: same as macOS, using the installed Brave/Chrome profile directly before slower fallbacks.

If profile access fails, the profile is locked, or the CLI cannot prove a signed-in consumer session, it moves on to the next fallback.

## Temporary browser fallback

If `doordash-cli login` opens a temporary Chromium window, finish signing in there and let the CLI save the session.

The CLI keeps checking automatically. If the page already shows that you are signed in but the command has not finished yet, press Enter in the terminal to force an immediate recheck.

If same-machine profile reuse is unavailable or cannot be proven, the next reuse path is an attachable browser automation session. After that, the CLI falls back to the temporary Chromium window it can watch directly.

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

## Legacy session migration

To keep existing users working, the CLI preserves compatibility with the historical session directory.

- If the canonical doordash-cli-owned directory is already in use, the CLI keeps using it.
- If the canonical directory is empty but legacy state exists under `~/.config/striderlabs-mcp-doordash`, the CLI copies that legacy state forward automatically.
- If that copy cannot complete yet, the CLI falls back to the legacy directory instead of breaking existing users.
