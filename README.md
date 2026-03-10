# doordash-cli

Local DoorDash CLI with a deliberately small, cart-safe command surface.

## Safety model

This project is intentionally limited to browsing and cart management:

- `auth-check`
- `auth-bootstrap`
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
  - one-time manual session bootstrap via `auth-bootstrap`
  - automatic session import from an already-open signed-in OpenClaw managed browser
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

### Managed-browser auto-import

If an OpenClaw-managed browser is already running with a signed-in DoorDash tab/session, `auth-check` and other direct commands automatically try to import that state into the saved direct-session files before launching a new local browser context.

Default probe order:

- `DOORDASH_MANAGED_BROWSER_CDP_URL`
- `OPENCLAW_BROWSER_CDP_URL`
- `OPENCLAW_OPENCLAW_CDP_URL`
- OpenClaw config hints from `~/.openclaw/openclaw.json`
- fallback default `http://127.0.0.1:18800`

### Recommended bootstrap

Use `auth-bootstrap` once when you need a fresh reusable session and there is no already-open signed-in managed browser to import:

```bash
dd-cli auth-bootstrap
```

That opens Chromium, lets you sign in manually, then saves the browser state for later direct API calls.

### `auth-check`

`auth-check` performs a direct `consumer` query and reports whether the saved state appears logged in, plus the default address if DoorDash returns one.

## Current scope / gaps

### Implemented direct support

- auth/session check
- managed-browser session import into saved direct-session state
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

- Direct request builders, parsers, managed-browser import, and address/configurable-item helpers live in `src/direct-api.ts`
- Safe command allowlist and command dispatch live in `src/lib.ts`
- CLI parsing/output lives in `src/cli.ts`
- Tests cover allowlist guardrails plus direct request-building and parsing helpers
