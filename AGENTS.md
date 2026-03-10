# AGENTS.md

Repo guidance for contributors working on `doordash-cli`.

- Treat this as a serious OSS CLI. Keep the UX coherent across command names, help text, README, examples, package metadata, and output. Docs should stay concise and high-signal.
- Keep the command surface **lowercase-only**. Supported bins are `dd-cli` and `doordash-cli`; user-facing docs should present the tool as **doordash-cli** unless a technical detail requires otherwise.
- Prefer the direct API path for core behavior. Browser automation is bootstrap/recovery glue, not the product.
- Preserve the cart-safe boundary. Do not add checkout, order placement, payment, tracking, or other real-order mutations without explicit approval. Fail closed when a payload or flow is not clearly proven.
- Keep PRs scoped. If you change commands, flags, or behavior, update the implementation, help text, README, and tests in the same PR.
- Before claiming done, run `npm run validate`; for CLI/package-surface changes also run `node dist/cli.js --help` and any targeted smoke checks. Prefer squash-and-merge.
