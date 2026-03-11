# Releasing doordash-cli

`doordash-cli` now uses a **true one-step manual release flow**.

When a maintainer decides it is time to ship, they run one GitHub Action and the workflow directly:

- picks the next version from conventional commits (or an explicit version override)
- updates `package.json`, `package-lock.json`, and `CHANGELOG.md`
- validates the release build
- smoke-tests the packed install
- builds the `.tgz` release artifact and SHA-256 checksum
- commits the release metadata back to `main`
- tags `vX.Y.Z`
- creates the GitHub Release and uploads the assets

No release PR. No second merge step. No waiting around for the “real” release after the release workflow.

Public npm publication now exists, but it is still a deliberate maintainer follow-up after the GitHub release flow rather than part of the workflow itself.

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

- `feat: add read-only order filter`
- `fix: handle missing session state`
- `feat!: rename auth bootstrap output`

Rules of thumb:

- Use **squash and merge**.
- Keep the final merged title user-meaningful.
- Reserve `!` / `BREAKING CHANGE:` for real breaking surface changes.
- Do **not** hand-bump versions or create release tags from feature branches.

## Maintainer release flow

1. Make sure `main` is in a releasable state.
2. Open **Actions → release → Run workflow**.
3. Leave `version` blank for the normal path.
   - The workflow will compute the next version from conventional commits since the last tag.
   - If there are no releasable commits, it exits cleanly without creating anything.
4. Optionally set:
   - `dry_run = true` to preview the release without pushing/tagging/publishing the GitHub Release
   - `version = X.Y.Z` only when you intentionally want to override the computed version
5. Run the workflow.

That single run will:

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

## Changelog and release notes

`CHANGELOG.md` is the source-controlled changelog and is updated automatically during the release workflow.

GitHub Release notes are generated from the same conventional-commit history. Keep release-worthy squash titles clean and user-meaningful.

Install and first-run docs should stay in:

- `README.md` for the quick path
- `docs/install.md` for the full install and setup flow

Do not treat GitHub Release bodies as the place for a giant evergreen install tutorial.

## npm publication

Public npm publication is live at <https://www.npmjs.com/package/doordash-cli>.

The GitHub Actions release workflow still creates the release commit, tag, GitHub Release, tarball, and checksum only. It does **not** publish to npm automatically.

Until automation is added intentionally, npm publication is a maintainer step run from an authenticated release machine.

### Release-machine auth

Authenticate once on the release machine and verify the active account before publishing:

```bash
npm login --auth-type=legacy --registry=https://registry.npmjs.org/
npm whoami
```

The maintainer account for this package is `latencytdh`.

### Manual npm publish step

After the GitHub release workflow finishes for `vX.Y.Z`, publish that same release from a clean checkout:

```bash
git fetch --tags origin
git checkout vX.Y.Z
npm ci
npm run validate
npm run smoke:pack
npm publish --access public
```

Then verify what npm received:

```bash
npm view doordash-cli version
npm view doordash-cli dist-tags --json
```

For an end-to-end user check, install into a clean prefix or environment and run both shipped commands:

```bash
npm install -g doordash-cli
doordash-cli --help
dd-cli --help
```

## Validation expectations

Before merging release-process changes, the minimum validation is still:

- `npm run validate`

For release tooling changes, also validate as appropriate:

- `node dist/bin.js --help`
- `npm pack --dry-run`
- release-tool dry runs / version previews
- workflow YAML sanity checks

## GitHub permissions

The workflow uses the built-in `GITHUB_TOKEN` with `contents: write` so it can:

- push the release commit back to `main`
- push the release tag
- create the GitHub Release
- upload release assets

Repository Actions settings should leave workflow permissions at **Read and write**.
