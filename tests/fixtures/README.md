# Sanitized fixture maintenance

These fixtures exist to catch DoorDash payload drift without requiring live credentials.

## Rules

- Never commit live cookies, tokens, auth headers, email addresses you care about, or payment/checkout data.
- Keep fixtures inside the cart-safe scope: auth state, address matching, browse/search/menu/item data, existing-order reads, cart reads, and cart mutation payload shapes.
- Prefer representative upstream payloads over toy objects, but sanitize aggressively.
- Preserve brittle structure when it matters. If DoorDash uses odd nesting, `__ref` links, `nextCursor`, or mixed optional/null fields, keep those shapes so the parser tests stay meaningful.

## Refresh workflow

1. Capture the smallest payload that reproduces the upstream shape change.
2. Remove secrets and user-identifying data.
3. Replace local paths, addresses, IDs, and emails with obvious fixture values unless the exact shape matters.
4. Keep numeric/string/null types intact; drift bugs often hide there.
5. Update the matching file in `tests/contracts/` only when the new normalized contract is intentionally accepted.
6. Run:
   - `npx vitest run`
   - `npm run validate`

## What should change rarely

The normalized contract snapshots under `tests/contracts/` are the intentional downstream interface. If a fixture changes but the contract should not, update parser logic until the old contract still passes.
