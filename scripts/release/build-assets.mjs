#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const outputDir = join(repoRoot, 'artifacts', 'releases');

mkdirSync(outputDir, { recursive: true });

for (const entry of readdirSync(outputDir)) {
  if (entry.endsWith('.tgz') || entry.endsWith('.sha256')) {
    rmSync(join(outputDir, entry), { force: true });
  }
}

const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', outputDir], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const packResult = JSON.parse(packOutput);
if (!Array.isArray(packResult) || packResult.length === 0 || typeof packResult[0]?.filename !== 'string') {
  throw new Error(`Unexpected npm pack output: ${packOutput}`);
}

const tarballName = packResult[0].filename;
const tarballPath = join(outputDir, tarballName);
const tarballBuffer = readFileSync(tarballPath);
const checksum = createHash('sha256').update(tarballBuffer).digest('hex');
const checksumPath = `${tarballPath}.sha256`;

writeFileSync(checksumPath, `${checksum}  ${basename(tarballPath)}\n`);

console.log(
  JSON.stringify(
    {
      tarball: tarballPath,
      checksum: checksumPath,
    },
    null,
    2,
  ),
);
