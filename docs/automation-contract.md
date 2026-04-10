# Automation contract

`doordash-cli` is usable interactively, but its supported machine-readable interface is **`--json` mode**.

Use `--json` for shell scripts, wrappers, cron jobs, CI checks, and any integration that needs stable parsing.

```bash
dd-cli --json auth-check
```

## Stability promise

In `--json` mode, the CLI guarantees:

- exactly one JSON document per invocation
- success JSON on `stdout`
- error JSON on `stderr`
- stable top-level envelope fields
- documented exit codes by failure class
- documented error codes for automation-facing failures

The per-command `data` payloads are the same command result objects the CLI already returns today. They are treated as supported contract surface for the cart-safe command set.

## Success envelope

```json
{
  "ok": true,
  "data": { "...": "command-specific payload" },
  "meta": {
    "command": "logout",
    "exitCode": 0,
    "version": "0.4.2"
  }
}
```

Fields:

- `ok`: always `true` for successful automation responses
- `data`: command-specific payload
- `meta.command`: resolved command name, or `null` for meta flows like `--version`
- `meta.exitCode`: always `0` on success
- `meta.version`: package version

## Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "unsupported_flag",
    "message": "Unsupported flag(s) for cart: payment-method. Allowed flags: (none)",
    "details": {
      "command": "cart",
      "unsupportedFlags": ["payment-method"],
      "allowedFlags": []
    }
  },
  "meta": {
    "command": "cart",
    "exitCode": 2,
    "version": "0.4.2"
  }
}
```

Fields:

- `ok`: always `false` for automation failures
- `error.code`: stable machine code
- `error.message`: human-readable explanation
- `error.details`: optional structured details for automation and debugging
- `meta.command`: command name when known, else `null`
- `meta.exitCode`: process exit code for the failure class
- `meta.version`: package version

## Exit codes

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Internal/unclassified CLI failure |
| `2` | Usage/validation failure |
| `3` | Unsupported or blocked command |
| `4` | Authentication was not established |
| `5` | Remote DoorDash/API failure |

Notes:

- `login` uses exit code `4` when authentication still is not established.
- `auth-check` remains a successful read operation even when `isLoggedIn` is `false`.
- In non-JSON mode the same exit codes apply, but human-readable stderr is preserved.

## Error codes

| Error code | Meaning |
| --- | --- |
| `usage_error` | Invalid or incomplete CLI usage |
| `unsupported_command` | Command is not part of the supported surface |
| `blocked_command` | Command is intentionally out of scope for cart-safe boundaries |
| `unsupported_flag` | Flag is not allowed for the selected command |
| `invalid_options_json` | `--options-json` could not be parsed as the supported selection array |
| `auth_failed` | Authentication was not established for `login` |
| `remote_error` | DoorDash, network, anti-bot, or remote API failure |
| `internal_error` | Unexpected internal CLI failure |

## Command data contracts

The following command payloads are part of the supported machine-readable surface in `--json` mode:

- `install-browser`
- `auth-check`
- `login`
- `logout`
- `set-address`
- `search`
- `menu`
- `item`
- `orders`
- `order`
- `add-to-cart`
- `update-cart`
- `cart`

The fixture suite in `tests/contract-fixtures.test.ts` locks representative sanitized payloads for:

- auth consumer parsing
- address matching and address-enrollment payload shaping
- search result parsing
- menu parsing
- item parsing
- cart parsing
- order-history parsing
- Apollo cache extraction for existing orders
- add-to-cart payload shaping, including nested-option drift sentinels
- update-cart payload shaping

## Examples

Successful automation call:

```bash
dd-cli --json logout
```

Usage failure:

```bash
dd-cli --json cart --payment-method visa
```

Legacy unsupported command rename:

```bash
dd-cli --json auth-bootstrap
```

## Recommendation

For scripts: always pass `--json` and branch on the process exit code first, then parse the JSON envelope.
