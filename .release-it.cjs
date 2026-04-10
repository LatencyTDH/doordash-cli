const fs = require('node:fs');
const path = require('node:path');

const CHANGELOG_HEADER = `# Changelog

All notable changes to \`doordash-cli\` will be documented in this file.

- Versions follow [Semantic Versioning](https://semver.org/).
- Release entries are generated from squash-merged conventional commits on \`main\`.
- Git tags use the \`vX.Y.Z\` form.
- Historical \`doordash-cli-vX.Y.Z\` tags are bridged locally during release automation.

See [docs/releasing.md](docs/releasing.md) for the maintainer release flow.`;

const pkgPath = path.join(__dirname, 'package.json');

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function isDependencyCommit(commit) {
  return commit.type === 'deps' || (commit.type === 'chore' && typeof commit.scope === 'string' && commit.scope.startsWith('deps'));
}

function summarizeCommits(commits) {
  const summary = {
    breaking: 0,
    features: 0,
    patches: 0,
  };

  for (const commit of commits) {
    if ((commit.notes || []).length > 0) {
      summary.breaking += commit.notes.length;
      continue;
    }

    switch (commit.type) {
      case 'feat':
      case 'feature':
        summary.features += 1;
        break;
      case 'fix':
      case 'perf':
      case 'revert':
        summary.patches += 1;
        break;
      default:
        if (isDependencyCommit(commit)) {
          summary.patches += 1;
        }
        break;
    }
  }

  return summary;
}

function whatBump(commits) {
  const currentVersion = getCurrentVersion();
  const isPreV1 = currentVersion.startsWith('0.');
  const summary = summarizeCommits(commits);

  if (summary.breaking > 0) {
    return {
      level: isPreV1 ? 1 : 0,
      reason: isPreV1
        ? `There ${summary.breaking === 1 ? 'is' : 'are'} ${summary.breaking} breaking change${summary.breaking === 1 ? '' : 's'} while ${currentVersion} is still pre-1.0, so the release stays on the minor track.`
        : `There ${summary.breaking === 1 ? 'is' : 'are'} ${summary.breaking} breaking change${summary.breaking === 1 ? '' : 's'}.`,
    };
  }

  if (summary.features > 0) {
    return {
      level: 1,
      reason: `There ${summary.features === 1 ? 'is' : 'are'} ${summary.features} feature commit${summary.features === 1 ? '' : 's'}.`,
    };
  }

  if (summary.patches > 0) {
    return {
      level: 2,
      reason: `There ${summary.patches === 1 ? 'is' : 'are'} ${summary.patches} patch-level conventional commit${summary.patches === 1 ? '' : 's'} (including dependency updates).`,
    };
  }

  return {
    level: null,
    reason: 'No releasable conventional commits were found since the last tag.',
  };
}

module.exports = {
  git: {
    requireBranch: 'main',
    requireUpstream: true,
    commitMessage: 'chore(release): ${version}',
    tagName: 'v${version}',
    tagAnnotation: 'Release ${version}',
  },
  npm: {
    // npm publication is handled explicitly in .github/workflows/release.yml
    // so dry runs can skip publishing while real runs publish with Actions secrets.
    publish: false,
  },
  github: {
    release: true,
    releaseName: 'doordash-cli v${version}',
    assets: ['artifacts/releases/*.tgz', 'artifacts/releases/*.sha256'],
  },
  hooks: {
    'before:init': 'node scripts/release/ensure-legacy-tag-alias.mjs',
    'after:bump': [
      'npm run validate',
      'npm run smoke:pack',
      'node scripts/release/check-changelog.mjs',
      'node scripts/release/build-assets.mjs',
    ],
  },
  plugins: {
    '@release-it/conventional-changelog': {
      infile: 'CHANGELOG.md',
      header: CHANGELOG_HEADER,
      preset: {
        name: 'conventionalcommits',
        bumpStrict: true,
        types: [
          { type: 'feat', section: 'Features' },
          { type: 'feature', section: 'Features' },
          { type: 'fix', section: 'Bug Fixes' },
          { type: 'perf', section: 'Performance' },
          { type: 'deps', section: 'Dependencies' },
          { type: 'chore', scope: 'deps', section: 'Dependencies' },
          { type: 'chore', scope: 'deps-dev', section: 'Dependencies' },
          { type: 'revert', section: 'Reverts', hidden: true },
          { type: 'docs', section: 'Documentation', hidden: true },
          { type: 'refactor', section: 'Refactoring', hidden: true },
          { type: 'test', section: 'Tests', hidden: true },
          { type: 'build', section: 'Build System', hidden: true },
          { type: 'ci', section: 'Continuous Integration', hidden: true },
          { type: 'chore', section: 'Miscellaneous', hidden: true },
          { type: 'style', section: 'Style', hidden: true },
        ],
      },
      whatBump,
    },
  },
};
