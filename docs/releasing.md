# Releasing doordash-cli

`doordash-cli` uses a **manual trigger, one-run release flow**.

When a maintainer decides it is time to ship, they run one GitHub Action and the workflow directly:

- picks the next version from conventional commits (or an explicit version override)
- updates `package.json`, `package-lock.json`, and `CHANGELOG.md`
- validates the release build
- smoke-tests the packed install
- builds the `.tgz` release artifact and SHA-256 checksum
- commits the release metadata back to `main`
- tags `vX.Y.Z`
- creates the GitHub Release and uploads the assets
- publishes the same version to npm on real non-dry-run releases

Dry runs keep the preview behavior: they do **not** push commits, create the GitHub Release, or publish to npm.

## Release architecture

The workflow keeps the responsibilities split cleanly:

- `release-it` handles versioning, changelog generation, the release commit, the Git tag, and the GitHub Release.
- GitHub Actions performs npm publication as a separate explicit workflow step after `release-it` succeeds.

That split keeps npm auth out of `release-it` config, makes dry-run behavior obvious, and lets the workflow gate publication with one condition.

## Why this replaced Release Please

The previous Release Please setup still required two human steps:

1. run the workflow
2. merge a generated release PR

That was fine for a PR-centric cadence, but it is unnecessary friction for a repo that wants a **manual-but-direct** release button. The Release Please flow has been removed and superseded by a `release-it` workflow that keeps the release cadence manual while making the actual release itself one action.

## Legacy tag migration guard

The historical `0.1.0` release used the old tag name `doordash-cli-v0.1.0`.

`release-it` discovers the previous release boundary from tags that match the current `vX.Y.Z` scheme, so a straight migration would otherwise miss that legacy tag and regenerate the entire pre-`0.1.0` history on the first run.

To keep the one-step workflow intact, release automation now runs `scripts/release/ensure-legacy-tag-alias.mjs` during `release-it` initialization. The script:

- finds legacy `doordash-cli-v*` tags
- creates matching local `v*` aliases when they are missing
- refuses to continue if a legacy tag and canonical `v*` tag disagree about which commit a version points to

The aliases are local migration shims for release tooling. They let `release-it` compute the right version/changelog boundary without reintroducing a release PR or relying on manual maintainer cleanup.

## Versioning policy

The project uses Semantic Versioning driven by conventional commits on `main`:

- `fix:` -> patch release
- `perf:` -> patch release
- `deps:` -> patch release
- `chore(deps):` / `chore(deps-dev):` -> patch release
- `feat:` -> minor release
- `!` or `BREAKING CHANGE:` -> breaking release

### Pre-1.0 behavior

While the CLI is still `< 1.0.0`, breaking changes intentionally bump the **minor** version instead of jumping straight to `1.0.0`.

That means the pre-v1 policy is:

- fixes/perf/deps -> patch
- features -> minor
- breaking changes -> minor

This keeps early releases honest without accidentally burning the major version too soon.

## Merge discipline

Release notes and version bumps are derived from the squash commits that land on `main`, so PR titles and final squash-merge titles need to use conventional commit style:

- `feat: add nested options support`
- `fix: handle missing session state`
- `chore(deps): bump playwright from 1.41.0 to 1.42.0`
- `feat!: rename auth bootstrap output`

Rules of thumb:

- Use **squash and merge**.
- Keep the final merged title user-meaningful.
- Dependabot-style `chore(deps)` / `chore(deps-dev)` squash titles are supported and will show up in the changelog under **Dependencies**.
- Reserve `!` / `BREAKING CHANGE:` for real breaking surface changes.
- Do **not** hand-bump versions or create release tags from feature branches.

## Maintainer release flow

1. Make sure `main` is in a releasable state.
2. Open **Actions → release → Run workflow**.
3. Leave `version` blank for the normal path.
   - The workflow computes the next version from conventional commits since the last tag.
   - If there are no releasable commits, it exits cleanly without creating anything.
4. Optionally set:
   - `dry_run = true` to preview the release without pushing, tagging, creating the GitHub Release, or publishing to npm
   - `version = X.Y.Z` only when you intentionally want to override the computed version
5. Run the workflow.

A real non-dry-run execution will:

- update `CHANGELOG.md`
- update `package.json` and `package-lock.json`
- run `npm run validate`
- run `npm run smoke:pack`
- build `artifacts/releases/*.tgz`
- build `artifacts/releases/*.sha256`
- commit `chore(release): X.Y.Z`
- push the commit to `main`
- create tag `vX.Y.Z`
- create the GitHub Release and attach the tarball/checksum assets
- publish `doordash-cli@X.Y.Z` to npm

## npm publish security model

The workflow uses the standard GitHub Actions npm-auth pattern:

- `actions/setup-node` writes npm registry configuration for `https://registry.npmjs.org`
- the repository or organization Actions secret `NPM_TOKEN` is exposed only to the npm auth preflight step and the dedicated npm publish step
- those steps map `NPM_TOKEN` to `NODE_AUTH_TOKEN`, which `npm whoami` and `npm publish` read automatically
- real releases verify npm auth before `release-it` runs, so a missing or invalid token fails early before tags or GitHub releases are created
- the token is never committed to the repo, hardcoded in workflow files, or printed in logs
- dry runs never execute the npm auth or npm publish steps

Recommended setup:

1. Create an npm token on the maintainer account that has publish access to `doordash-cli`.
2. Store it as a GitHub Actions secret named `NPM_TOKEN` at the repository or organization level.
3. Keep the secret scoped to release automation rather than copying it into multiple systems.

One secret is enough for this repo. No checked-in `.npmrc` token, no extra release-machine credential sprawl.

## CI and release guardrails

Pull requests validate the supported runtime matrix before merge:

- Ubuntu on Node.js 20
- Ubuntu on Node.js 22
- macOS on Node.js 22

The Ubuntu/Node 22 lane also keeps the packed-install smoke test in CI so the published file list stays honest.

Release-sensitive changes additionally run `npm run release:smoke`, which clones the repo into a disposable temp directory, performs a local `release-it` run with an explicit throwaway version, and verifies the generated changelog, package metadata, git tag, and release artifacts without pushing or publishing anything.

That gives the repo two layers of protection:

- day-to-day PR validation across the declared supported Node majors
- a release-pipeline rehearsal that catches changelog/package/release regressions before anyone reaches for the manual release button

## Workflow runtime version

CI exercises Node.js 20 and 22, while release automation itself runs on Node.js 22.

That keeps the published package honest about `engines.node >=20` without forcing the release machinery off the current LTS track.

## Changelog and release notes

`CHANGELOG.md` is the source-controlled changelog and is updated automatically during the release workflow.

GitHub Release notes are generated from the same conventional-commit history. Keep release-worthy squash titles clean and user-meaningful.

Install and first-run docs should stay in:

- `README.md` for the quick path
- `docs/install.md` for the full install and setup flow

Do not treat GitHub Release bodies as the place for a giant evergreen install tutorial.

## Validation expectations

Before merging release-process changes, the minimum local validation is:

- `npm run validate`
- `npm run smoke:pack`
- `npm run release:smoke`

`npm run validate` now includes the changelog-history guard so duplicated release sections or malformed compare-link chains fail fast.

For release tooling changes, also validate as appropriate:

- `node dist/bin.js --help`
- `npm pack --dry-run`
- `npm publish --dry-run`
- release-tool dry runs / version previews
- workflow YAML sanity checks

## GitHub permissions

The workflow uses the built-in `GITHUB_TOKEN` with `contents: write` so it can:

- push the release commit back to `main`
- push the release tag
- create the GitHub Release
- upload release assets

Repository Actions settings should leave workflow permissions at **Read and write**.
