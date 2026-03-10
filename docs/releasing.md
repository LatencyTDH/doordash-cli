# Releasing doordash-cli

`doordash-cli` uses a release flow that is meant to feel boring in the best way: merge good PRs, decide when you actually want a release, review the generated release PR, merge it, and get a tagged GitHub release with a validated package artifact.

## Versioning policy

The project uses Semantic Versioning.

- `fix:` -> patch release
- `feat:` -> minor release
- `!` or `BREAKING CHANGE:` -> breaking release

While the CLI is still `< 1.0.0`, breaking changes bump the **minor** version instead of jumping straight to `1.0.0`. That keeps early releases honest without burning major versions too early.

## Merge discipline

Releases are driven from the squash commit that lands on `main`, so PR titles and squash-merge commit titles need to use conventional commit style:

- `feat: add read-only order filter`
- `fix: handle missing session state`
- `feat!: rename auth bootstrap output`

Rules of thumb:

- Use **squash and merge**.
- Keep the final merged title user-meaningful.
- Reserve `!` / `BREAKING CHANGE:` for real breaking surface changes.
- Do **not** hand-bump versions or create release tags from feature branches.

## Automated release flow

The repo uses Release Please with a **manual release cadence**.

1. Feature and fix PRs merge into `main` as usual.
2. When you actually want to cut a release, run the `release-please` workflow manually against `main`.
   - GitHub UI: **Actions → release-please → Run workflow**
   - CLI: `gh workflow run release-please.yml --ref main`
3. Release Please opens or updates a release PR with:
   - the next version
   - `package.json` / `package-lock.json` version bumps
   - `CHANGELOG.md` updates
4. A maintainer reviews that release PR like any other scoped change.
5. Merging the release PR back to `main` triggers the workflow again only for that release commit, which then:
   - creates the Git tag in `vX.Y.Z` format
   - creates the GitHub Release
   - checks out the tagged release SHA
   - runs `npm ci`
   - runs `npm run validate`
   - runs `npm run smoke:pack`
   - builds the npm tarball with `npm pack`
   - uploads the tarball and a SHA-256 checksum to the GitHub Release

That makes GitHub Releases the canonical release record immediately, even before npm publication is enabled, without firing release automation on every normal merge to `main`.

## Changelog and release notes

`CHANGELOG.md` is the source-controlled changelog. Release Please maintains it from the merged commit history on `main`.

To keep release notes clean:

- prefer `feat:` and `fix:` for user-visible work
- keep docs/chore/test-only PRs out of the changelog when they are not user-relevant
- write PR titles the way you want them to read in release notes

If a release PR needs small editorial cleanup, edit the release PR before merging rather than rewriting tags later.

## npm publish later (issue #12)

Actual npm publication is intentionally **out of scope for now**.

When npm auth is set up in issue #12, the intended flow is:

1. keep cutting tagged GitHub releases through the existing release PR flow
2. configure npm auth intentionally (`npm whoami` / `NPM_TOKEN`)
3. publish the exact tagged release version to npm from the release commit
4. verify install from npm (`npm install -g doordash-cli`)

Until that lands, do **not** publish ad hoc from a laptop branch or unpublished local state.

## Maintainer checklist

Before running the release workflow:

- confirm `main` is in a releasable state
- decide that this is actually the moment you want a release PR

Before merging a release PR:

- confirm the proposed version bump makes sense
- skim `CHANGELOG.md` for tone and accuracy
- confirm the repo is still in a releasable state

After the release PR merges:

- confirm the GitHub Release exists
- confirm the `.tgz` asset and `.sha256` checksum uploaded successfully
- leave npm publication for issue #12

## Notes on GitHub tokens

The workflow uses the built-in `GITHUB_TOKEN`, so it does not require extra secrets just to cut GitHub releases.

Repository Actions settings must leave default workflow permissions at **Read and write** so the workflow can open release PRs. The workflow itself is still explicitly scoped to the minimum permissions it needs (`contents`, `issues`, and `pull-requests` write), and `can_approve_pull_request_reviews` can stay disabled.

If the repo later adds CI that must run on release PRs created by automation, switch Release Please to a maintainer PAT with the appropriate repo permissions. That is not required for the current setup.
