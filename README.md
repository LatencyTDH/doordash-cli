# doordash-cli

Local DoorDash CLI with a deliberately small, cart-safe command surface.

## Safety model

This project is intentionally limited to browsing and cart management:

- `auth-check`
- `auth-bootstrap`
- `login` (alias of `auth-bootstrap`)
- `auth-clear`
- `set-address`
- `search`
- `menu`
- `item`
- `add-to-cart`
- `update-cart`
- `cart`

It does **not** expose or call:

- checkout
- place-order
- track-order
- payment actions

The CLI enforces this in code, not just docs:

- only allowlisted commands are accepted
- known dangerous commands return a hard failure immediately
- unknown flags are rejected before any DoorDash work runs

## Direct API approach

The primary path is DoorDash consumer-web GraphQL/HTTP, not DOM clicking:

- `auth-check`, `set-address`, `search`, `menu`, `item`, `cart`, `add-to-cart`, and `update-cart` use direct request builders + parsers
- browser usage is limited to:
  - importing session state from the user's existing signed-in Chromium-family browser
  - opening DoorDash in the default browser during `auth-bootstrap`, then importing that attached session when available
  - protocol research / recovery when DoorDash changes behavior

This keeps the core integration focused on stable request/response shapes instead of fragile page selectors.

## Install

From this directory:

```bash
npm install
npm run build
npm link
```

If Playwright asks for browser binaries, install Chromium:

```bash
npx playwright install chromium
```

## Usage

Run the compiled CLI directly:

```bash
node dist/cli.js --help
```

Or after `npm link`:

```bash
dd-cli --help
doordash-cli --help
```

Examples:

```bash
dd-cli auth-check
dd-cli auth-bootstrap
dd-cli login
dd-cli auth-clear
dd-cli set-address --address "350 5th Ave, New York, NY 10118"
dd-cli search --query sushi
dd-cli search --query tacos --cuisine mexican
dd-cli menu --restaurant-id 1721744
dd-cli item --restaurant-id 1721744 --item-id 546936015
dd-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
dd-cli add-to-cart --restaurant-id 1721744 --item-id 546936015 --options-json '[{"groupId":"703393388","optionId":"4716032529"},{"groupId":"703393389","optionId":"4716042466"}]'
dd-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 1
dd-cli cart
```

Output is JSON so it can be scripted easily.

## Session / auth expectations

The CLI keeps session material under the same config root as the upstream project:

- cookies: `~/.config/striderlabs-mcp-doordash/cookies.json`
- direct-session browser state: `~/.config/striderlabs-mcp-doordash/storage-state.json`

### Attached-browser auto-import

`auth-check`, `auth-bootstrap`, and the other direct commands only try to reuse a signed-in session from your existing/main Chromium-family browser when a CDP endpoint is reachable. This is intentionally generic: it works with Chrome, Brave, Edge, or another Chromium-based browser exposing CDP, and it favors your real logged-in profile to reduce anti-bot friction.

Probe order:

- `DOORDASH_ATTACHED_BROWSER_CDP_URLS` / `DOORDASH_BROWSER_CDP_URLS` (comma- or newline-separated)
- `DOORDASH_ATTACHED_BROWSER_CDP_URL` or `DOORDASH_BROWSER_CDP_URL`
- `DOORDASH_BROWSER_CDP_PORTS` / `DOORDASH_BROWSER_CDP_PORT` (localhost)
- OpenClaw config profiles `browser.profiles.user` / `browser.profiles.chrome` when present
- fallback defaults `http://127.0.0.1:18792` (OpenClaw Chrome extension relay) and `http://127.0.0.1:9222` (standard remote debugging)

There is no separate managed-Chromium login fallback anymore.

### `auth-bootstrap` / `login` (`az login`-style)

Use `auth-bootstrap` or the shorter `login` alias when you want the CLI to open DoorDash in your default browser and wait for a reusable session:

```bash
dd-cli auth-bootstrap
dd-cli login
```

Behavior:

1. the CLI first tries to import an already-signed-in attached browser session
2. if it cannot, it opens `https://www.doordash.com/home` in your default browser
3. it waits for you to finish signing in in that same browser session
4. once the attached browser session is authenticated, it saves cookies/storage state for later direct API calls

If no attachable Chromium CDP endpoint is reachable, the CLI still opens the URL and tells you how to expose your main browser session (for example `--remote-debugging-port=9222` or a configured attached-browser CDP URL). That is the remaining infrastructure requirement for full browser-open → import automation in a generic OSS setup.

### `auth-check`

`auth-check` performs a direct `consumer` query and reports whether the saved state appears logged in, plus the default address if DoorDash returns one.

## Current scope / gaps

### Implemented direct support

- auth/session check
- attached-browser session import into saved direct-session state
- search
- menu fetch
- item detail fetch
- cart read
- add-to-cart for quick-add items
- add-to-cart for configurable items **when explicit `--options-json` selections are provided and all selected options are validated against item/menu data**
- add-to-cart for standalone recommended add-ons that open a nested cursor-driven child step **when the child selections are supplied via `children` in `--options-json` and the group is a proven `recommended_option_*` standalone transport**
- update-cart by cart item id
- direct address persistence for both:
  - saved addresses already present in the account's DoorDash address book
  - brand-new freeform addresses resolved through DoorDash autocomplete + geo `get-or-create` + `addConsumerAddressV2`

### Not implemented / intentionally limited

- checkout / order placement / tracking / payment
- non-recommended nested cursor-driven option trees whose transport is not yet directly provable from DoorDash's standalone-item batch cart path

If the CLI cannot prove a payload safely from known item/address data, it fails closed with a clear message instead of guessing.

## `set-address` note

`set-address` is now direct for both saved and brand-new addresses:

- the CLI first looks for a match in `getAvailableAddresses`
- if needed, it uses autocomplete + geo `get-or-create` to resolve the freeform text
- when DoorDash already exposes a matching saved address, it calls `updateConsumerDefaultAddressV2(defaultAddressId)`
- otherwise it builds the exact `addConsumerAddressV2(...)` mutation payload DoorDash web uses for new-address enrollment and lets DoorDash persist the address directly

The CLI still fails closed if DoorDash resolves the text but omits required fields for a complete `addConsumerAddressV2` payload (for example, missing stable coordinates or place id).

## Configurable items note

For items with required option groups, pass `--options-json` as a JSON array of selection objects:

```json
[
  { "groupId": "703393388", "optionId": "4716032529" },
  { "groupId": "703393389", "optionId": "4716042466" }
]
```

Nested standalone recommended add-ons use recursive `children` selections:

```json
[
  { "groupId": "703393388", "optionId": "4716032529" },
  { "groupId": "703393389", "optionId": "4716042466" },
  {
    "groupId": "recommended_option_546935995",
    "optionId": "546936011",
    "children": [{ "groupId": "780057412", "optionId": "4702669757" }]
  }
]
```

Guardrails:

- unknown group IDs are rejected
- unknown option IDs are rejected
- min/max group counts are enforced
- duplicate selections with nested `children` are rejected
- only DoorDash's proven standalone recommended-item transport (`recommended_option_*` → `lowPriorityBatchAddCartItemInput`) is used for nested cursor steps
- other non-recommended `nextCursor` trees still fail closed instead of guessing a cart shape

## Security caveats

- This is an unofficial integration against DoorDash consumer-web traffic.
- DoorDash can change request shapes, anti-bot checks, or session behavior at any time.
- Review results before trusting them for anything important.
- Because this tool is intentionally cart-safe, actual ordering still requires a manual step outside this CLI.

## Development

Validation commands:

```bash
npm run typecheck
npm run build
npm test
node dist/cli.js --help
node dist/cli.js checkout
node dist/cli.js cart --payment-method visa
```

Expected behavior:

- typecheck passes
- build passes
- tests pass
- help shows only the safe command surface
- `checkout` fails immediately as blocked
- unknown flags fail before any DoorDash work runs

## Implementation notes

- Direct request builders, parsers, attached-browser import/bootstrap helpers, and address/configurable-item helpers live in `src/direct-api.ts`
- Safe command allowlist and command dispatch live in `src/lib.ts`
- CLI parsing/output lives in `src/cli.ts`
- Tests cover allowlist guardrails plus direct request-building and parsing helpers
