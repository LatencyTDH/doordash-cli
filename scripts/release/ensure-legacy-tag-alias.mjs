import { execFileSync } from 'node:child_process';

const LEGACY_PREFIX = 'doordash-cli-v';
const CANONICAL_PREFIX = 'v';

function git(args, { stdio = 'pipe' } = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : stdio,
  }).trim();
}

function gitMaybe(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function listTags(pattern) {
  const output = git(['tag', '--list', pattern, '--sort=-version:refname']);
  return output ? output.split('\n').map(tag => tag.trim()).filter(Boolean) : [];
}

function resolveTagCommit(tag) {
  return git(['rev-list', '-n', '1', `${tag}^{commit}`]);
}

const legacyTags = listTags(`${LEGACY_PREFIX}*`);

if (legacyTags.length === 0) {
  console.log('release-tag-migration: no legacy doordash-cli-v* tags found');
  process.exit(0);
}

const createdAliases = [];

for (const legacyTag of legacyTags) {
  const version = legacyTag.slice(LEGACY_PREFIX.length);
  const canonicalTag = `${CANONICAL_PREFIX}${version}`;
  const legacyCommit = resolveTagCommit(legacyTag);
  const canonicalCommit = gitMaybe(['rev-list', '-n', '1', `${canonicalTag}^{commit}`]);

  if (canonicalCommit) {
    if (canonicalCommit !== legacyCommit) {
      throw new Error(
        `Refusing to bridge ${legacyTag} -> ${canonicalTag}: tags point at different commits (${legacyCommit} vs ${canonicalCommit}).`
      );
    }

    continue;
  }

  git(['tag', canonicalTag, legacyCommit]);
  createdAliases.push({ canonicalTag, legacyTag, legacyCommit });
}

if (createdAliases.length === 0) {
  console.log('release-tag-migration: canonical v* aliases already cover every legacy release tag');
  process.exit(0);
}

for (const { canonicalTag, legacyTag, legacyCommit } of createdAliases) {
  console.log(`release-tag-migration: created local alias ${canonicalTag} -> ${legacyTag} (${legacyCommit})`);
}
