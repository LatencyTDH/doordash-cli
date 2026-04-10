## Summary

- 

## Linked issues

- 

## Validation

- [ ] `npm run validate`
- [ ] `npm run smoke:pack` (if packaging/docs shipped in npm changed)
- [ ] `npm run release:smoke` (if release tooling/changelog/workflows changed)
- [ ] Other relevant checks:

## Cart-safe / scope review

- [ ] This PR does **not** add checkout, payment, cancellation, or other irreversible order mutation behavior.
- [ ] New or changed commands still fail closed for unsupported/unsafe cases.
- [ ] Help text, docs, and examples were updated if the user-facing behavior changed.

## Release / maintainer notes

- [ ] Conventional-commit squash title planned
- [ ] Changelog / release impact explained when relevant
- [ ] No secrets, cookies, or sensitive local data were committed
