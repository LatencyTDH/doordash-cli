#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const tempDir = mkdtempSync(join(tmpdir(), 'doordash-cli-release-smoke-'));

function run(command, args, cwd = repoRoot, { env = process.env } = {}) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parsePackageJson(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
}

function parsePackageLock(directory) {
  return JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
}

function incrementPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Cannot derive smoke version from unsupported package version: ${version}`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

try {
  run('git', ['clone', '--no-local', repoRoot, tempDir], dirname(repoRoot));
  run(
    'rsync',
    ['-a', '--delete', '--exclude', '.git', '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', 'artifacts', `${repoRoot}/`, `${tempDir}/`],
    dirname(repoRoot),
  );
  run('git', ['checkout', '-B', 'main'], tempDir);
  run('git', ['branch', '--set-upstream-to=origin/main', 'main'], tempDir);
  run('git', ['config', 'user.name', 'release-smoke[bot]'], tempDir);
  run('git', ['config', 'user.email', 'release-smoke[bot]@users.noreply.github.com'], tempDir);

  if (run('git', ['status', '--porcelain'], tempDir)) {
    run('git', ['add', '-A'], tempDir);
    run('git', ['commit', '--no-verify', '-m', 'chore: prepare release smoke sandbox'], tempDir);
  }

  run('npm', ['ci'], tempDir, { env: { ...process.env, CI: '1' } });

  const currentVersion = parsePackageJson(tempDir).version;
  const smokeVersion = incrementPatch(currentVersion);

  run(
    'npx',
    ['release-it', '--ci', '--no-git.push', '--no-github.release', smokeVersion],
    tempDir,
    {
      env: {
        ...process.env,
        CI: '1',
      },
    },
  );

  const packageJson = parsePackageJson(tempDir);
  const packageLock = parsePackageLock(tempDir);

  if (packageJson.version !== smokeVersion) {
    throw new Error(`package.json version ${packageJson.version} did not update to smoke version ${smokeVersion}`);
  }

  if (packageLock.version !== smokeVersion || packageLock.packages?.['']?.version !== smokeVersion) {
    throw new Error(`package-lock.json did not update cleanly to smoke version ${smokeVersion}`);
  }

  const changelog = readFileSync(join(tempDir, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`## [${smokeVersion}]`)) {
    throw new Error(`CHANGELOG.md did not gain a top-level entry for ${smokeVersion}`);
  }

  run('node', ['scripts/release/check-changelog.mjs'], tempDir, { env: { ...process.env, CI: '1' } });

  const releaseArtifactsDir = join(tempDir, 'artifacts', 'releases');
  const releaseArtifacts = existsSync(releaseArtifactsDir) ? readdirSync(releaseArtifactsDir).sort() : [];
  const tarballs = releaseArtifacts.filter(entry => entry.endsWith('.tgz'));
  const checksums = releaseArtifacts.filter(entry => entry.endsWith('.sha256'));

  if (tarballs.length !== 1 || checksums.length !== 1) {
    throw new Error(`Expected exactly one tarball and one checksum, found ${tarballs.length} tarballs and ${checksums.length} checksum files.`);
  }

  const tagName = run('git', ['tag', '--list', `v${smokeVersion}`], tempDir);
  if (tagName !== `v${smokeVersion}`) {
    throw new Error(`Expected smoke release to create tag v${smokeVersion}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        currentVersion,
        smokeVersion,
        tag: tagName,
        artifacts: releaseArtifacts,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
