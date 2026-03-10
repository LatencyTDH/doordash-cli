#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const tempRoot = mkdtempSync(join(tmpdir(), "doordash-cli-pack-"));
const prefixDir = join(tempRoot, "prefix");
mkdirSync(prefixDir, { recursive: true });

function run(command, args, cwd = repoRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let tarballPath;

try {
  const packOutput = run("npm", ["pack", "--json"]);
  const packResult = JSON.parse(packOutput);
  if (!Array.isArray(packResult) || packResult.length === 0 || typeof packResult[0]?.filename !== "string") {
    throw new Error(`Unexpected npm pack output: ${packOutput}`);
  }

  tarballPath = join(repoRoot, packResult[0].filename);

  run("npm", ["install", "--prefix", prefixDir, "-g", tarballPath]);

  const binPath = process.platform === "win32"
    ? join(prefixDir, "doordash-cli.cmd")
    : join(prefixDir, "bin", "doordash-cli");
  const helpOutput = run(binPath, ["--help"]);
  const versionOutput = run(binPath, ["--version"]).trim();

  if (versionOutput !== packageVersion) {
    throw new Error(`Unexpected installed version output: ${versionOutput}`);
  }

  if (!helpOutput.includes(`doordash-cli v${packageVersion}`) || !helpOutput.includes("auth-bootstrap")) {
    throw new Error("Installed help output did not include the expected command surface");
  }

  const installedPackageRoot = join(prefixDir, "lib", "node_modules", "doordash-cli");
  const installedManPage = join(installedPackageRoot, "man", "doordash-cli.1");
  const installedExamples = join(installedPackageRoot, "docs", "examples.md");
  const installedInstallGuide = join(installedPackageRoot, "docs", "install.md");
  const installedChangelog = join(installedPackageRoot, "CHANGELOG.md");
  const installedLicense = join(installedPackageRoot, "LICENSE");

  for (const expectedPath of [installedManPage, installedExamples, installedInstallGuide, installedChangelog, installedLicense]) {
    if (!existsSync(expectedPath)) {
      throw new Error(`Expected packaged file is missing after install: ${expectedPath}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        tarball: packResult[0].filename,
        binPath,
        version: versionOutput,
        verifiedFiles: [
          "man/doordash-cli.1",
          "docs/examples.md",
          "docs/install.md",
          "CHANGELOG.md",
          "LICENSE",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
