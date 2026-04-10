#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');

const sectionHeadingPattern = /^## (?:(?:\[(?<linkedVersion>\d+\.\d+\.\d+)\]\((?<compareUrl>[^)]+)\))|(?<plainVersion>\d+\.\d+\.\d+)) \((?<date>\d{4}-\d{2}-\d{2})\)$/gm;
const sections = [];

for (const match of changelog.matchAll(sectionHeadingPattern)) {
  sections.push({
    version: match.groups?.linkedVersion ?? match.groups?.plainVersion,
    compareUrl: match.groups?.compareUrl ?? null,
    date: match.groups?.date,
    headingIndex: match.index ?? 0,
    headingText: match[0],
  });
}

function fail(message) {
  throw new Error(`CHANGELOG validation failed: ${message}`);
}

if (sections.length === 0) {
  fail('no release headings were found.');
}

for (let index = 0; index < sections.length; index += 1) {
  const current = sections[index];
  const next = sections[index + 1];
  const bodyStart = current.headingIndex + current.headingText.length;
  const bodyEnd = next ? next.headingIndex : changelog.length;
  current.body = changelog.slice(bodyStart, bodyEnd).trim();
}

function parseVersion(version) {
  return version.split('.').map(value => Number.parseInt(value, 10));
}

function compareVersions(left, right) {
  const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
  const [rightMajor, rightMinor, rightPatch] = parseVersion(right);

  if (leftMajor !== rightMajor) {
    return leftMajor - rightMajor;
  }
  if (leftMinor !== rightMinor) {
    return leftMinor - rightMinor;
  }
  return leftPatch - rightPatch;
}

function normalizeBody(body) {
  return body
    .replace(/\[[^\]]+\]\([^)]*\/commit\/[0-9a-f]{7,40}\)/g, '[commit]')
    .replace(/\[[^\]]+\]\([^)]*\/issues\/\d+\)/g, '[issue]')
    .replace(/\s+/g, ' ')
    .trim();
}

function allowedTagRefs(version) {
  return new Set([`v${version}`, `doordash-cli-v${version}`]);
}

function parseCompareUrl(compareUrl) {
  const match = compareUrl.match(/\/compare\/([^./?#][^?#]*?)\.\.\.([^/?#]+)(?:[?#].*)?$/);
  if (!match) {
    fail(`could not parse compare URL ${compareUrl}`);
  }

  return {
    fromRef: decodeURIComponent(match[1]),
    toRef: decodeURIComponent(match[2]),
  };
}

const seenVersions = new Set();
const duplicateBodies = new Map();
let allowedBridgeGapCount = 0;

for (let index = 0; index < sections.length; index += 1) {
  const current = sections[index];
  const next = sections[index + 1] ?? null;

  if (seenVersions.has(current.version)) {
    fail(`version ${current.version} appears more than once.`);
  }
  seenVersions.add(current.version);

  if (next && compareVersions(current.version, next.version) <= 0) {
    fail(`versions are not in descending order at ${current.version} -> ${next.version}.`);
  }

  const normalizedBody = normalizeBody(current.body);
  if (normalizedBody) {
    const priorVersion = duplicateBodies.get(normalizedBody);
    if (priorVersion) {
      fail(`versions ${priorVersion} and ${current.version} have identical normalized release contents.`);
    }
    duplicateBodies.set(normalizedBody, current.version);
  }

  if (!current.compareUrl) {
    const isOldestSection = index === sections.length - 1;
    const isOneTimeHistoricalBridge = index === sections.length - 2;

    if (isOldestSection) {
      continue;
    }

    if (isOneTimeHistoricalBridge && allowedBridgeGapCount === 0) {
      allowedBridgeGapCount += 1;
      continue;
    }

    fail(`version ${current.version} is missing a compare link outside the supported oldest-release/history-bridge cases.`);
  }

  const { fromRef, toRef } = parseCompareUrl(current.compareUrl);
  if (!allowedTagRefs(current.version).has(toRef)) {
    fail(`compare link for ${current.version} points to ${toRef}, expected v${current.version} or doordash-cli-v${current.version}.`);
  }

  if (next) {
    if (!allowedTagRefs(next.version).has(fromRef)) {
      fail(`compare link for ${current.version} starts from ${fromRef}, expected the adjacent prior version ${next.version}.`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sections: sections.map(section => ({
        version: section.version,
        compareUrl: section.compareUrl,
        date: section.date,
      })),
      allowedHistoryBridgeSections: allowedBridgeGapCount,
    },
    null,
    2,
  ),
);
