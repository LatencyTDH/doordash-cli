# Security Policy

`doordash-cli` is an unofficial integration against DoorDash consumer-web traffic. Security work here is mostly about keeping the CLI cart-safe, protecting local auth/session state, and avoiding unsafe command expansion.

## Supported versions

Security fixes are targeted at:

- the latest release on npm
- the current `main` branch

Older releases may receive guidance, but fixes are not guaranteed to be backported.

## How to report a vulnerability

Please **do not open a public issue with exploit details** for security-sensitive findings.

Preferred path:

1. Use GitHub's private vulnerability reporting / repository security advisory flow for this repository if it is available to you.
2. If you cannot use that flow, contact the maintainer privately via the contact path linked from <https://github.com/LatencyTDH> / <https://seand.ai>.
3. If you still cannot reach the maintainer privately, open a minimal public issue that says you have a security report and need a private contact channel — but do **not** include reproduction steps, tokens, cookies, raw payloads, or exploit details.

Include as much of the following as you safely can:

- affected version / commit
- impact summary
- reproduction steps
- whether the issue requires local machine access, an authenticated DoorDash session, or a malicious payload
- whether sensitive data may have been exposed
- any suggested fix or mitigation

## What is in scope

Examples of security-relevant issues for this repo:

- bypasses of the cart-safe command or payload boundaries
- checkout/payment/order-mutation functionality becoming reachable unintentionally
- credential, cookie, or persisted session leakage
- unsafe browser-session import behavior
- command injection, path traversal, or packaging/release artifact tampering
- logs or error output that expose secrets or highly sensitive data

## What is usually out of scope

These are generally not treated as repo security bugs unless they create a concrete vulnerability in `doordash-cli` itself:

- upstream DoorDash anti-bot changes or schema drift
- ordinary install/setup failures
- feature requests for broader command coverage
- reports that require risky production use outside the documented cart-safe surface

## Safe testing expectations

Please keep research responsible and minimal:

- do not attempt checkout, payment, cancellation, or other irreversible order actions
- do not access data that is not yours
- do not exfiltrate tokens, cookies, or personal data
- do not use excessive automation that could degrade third-party systems

## Disclosure and response expectations

The maintainer will try to:

- acknowledge a good-faith report promptly
- confirm whether the issue is accepted / reproducible
- coordinate a fix and reasonable disclosure timing

Please give the maintainer time to investigate and patch before publishing details.

If you are unsure whether something is security-sensitive, err on the side of private reporting first.
