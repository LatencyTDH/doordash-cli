import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveCanonicalSessionConfigDir,
  resolveLegacySessionConfigDir,
  resolveSessionStorageOverrideDir,
  resolveSessionStoragePaths,
} from "./session-storage.js";

test("resolveCanonicalSessionConfigDir prefers XDG state/config locations on unix-like platforms", () => {
  const homeDir = "/tmp/example-home";

  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "linux",
      homeDir,
      env: { XDG_STATE_HOME: "/tmp/xdg-state" } as NodeJS.ProcessEnv,
    }),
    join("/tmp/xdg-state", "doordash-cli"),
  );

  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "linux",
      homeDir,
      env: { XDG_CONFIG_HOME: "/tmp/xdg-config" } as NodeJS.ProcessEnv,
    }),
    join("/tmp/xdg-config", "doordash-cli"),
  );

  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "linux",
      homeDir,
      env: {} as NodeJS.ProcessEnv,
    }),
    join(homeDir, ".local", "state", "doordash-cli"),
  );
});

test("resolveCanonicalSessionConfigDir uses native macOS and Windows app directories", () => {
  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "darwin",
      homeDir: "/Users/example",
      env: {} as NodeJS.ProcessEnv,
    }),
    join("/Users/example", "Library", "Application Support", "doordash-cli"),
  );

  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "win32",
      homeDir: "C:\\Users\\Example",
      env: { APPDATA: "C:\\Users\\Example\\AppData\\Roaming" } as NodeJS.ProcessEnv,
    }),
    join("C:\\Users\\Example\\AppData\\Roaming", "doordash-cli"),
  );
});

test("resolveSessionStorageOverrideDir and canonical path honor explicit env overrides", () => {
  const env = {
    DOORDASH_CLI_SESSION_DIR: "/tmp/doordash-cli-ci",
    DOORDASH_CLI_CONFIG_DIR: "/tmp/ignored-because-session-dir-wins",
  } as NodeJS.ProcessEnv;

  assert.equal(resolveSessionStorageOverrideDir({ env }), "/tmp/doordash-cli-ci");
  assert.equal(
    resolveCanonicalSessionConfigDir({
      platform: "linux",
      homeDir: "/tmp/example-home",
      env,
    }),
    "/tmp/doordash-cli-ci",
  );
});

test("resolveLegacySessionConfigDir preserves the historical StriderLabs location for migration", () => {
  assert.equal(
    resolveLegacySessionConfigDir({
      platform: "linux",
      homeDir: "/tmp/example-home",
      env: {} as NodeJS.ProcessEnv,
    }),
    join("/tmp/example-home", ".config", "striderlabs-mcp-doordash"),
  );
});

test("resolveSessionStoragePaths migrates legacy session artifacts into the canonical doordash-cli directory", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "doordash-cli-session-storage-"));
  const legacyDir = join(tempHome, ".config", "striderlabs-mcp-doordash");
  const canonicalDir = join(tempHome, ".local", "state", "doordash-cli");

  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "cookies.json"), JSON.stringify([{ name: "session" }]));
  writeFileSync(join(legacyDir, "storage-state.json"), JSON.stringify({ cookies: [], origins: [] }));
  writeFileSync(join(legacyDir, "browser-import-blocked"), "logged-out\n");

  try {
    const resolution = resolveSessionStoragePaths({
      platform: "linux",
      homeDir: tempHome,
      env: {} as NodeJS.ProcessEnv,
    });

    assert.equal(resolution.source, "migrated-legacy");
    assert.equal(resolution.active.sessionConfigDir, canonicalDir);
    assert.equal(existsSync(join(canonicalDir, "cookies.json")), true);
    assert.equal(existsSync(join(canonicalDir, "storage-state.json")), true);
    assert.equal(existsSync(join(canonicalDir, "browser-import-blocked")), true);
    assert.equal(readFileSync(join(canonicalDir, "cookies.json"), "utf8"), readFileSync(join(legacyDir, "cookies.json"), "utf8"));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("resolveSessionStoragePaths falls back to the legacy directory when migration cannot complete", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "doordash-cli-session-storage-"));
  const legacyDir = join(tempHome, ".config", "striderlabs-mcp-doordash");

  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "cookies.json"), JSON.stringify([{ name: "session" }]));

  try {
    const resolution = resolveSessionStoragePaths({
      platform: "linux",
      homeDir: tempHome,
      env: {} as NodeJS.ProcessEnv,
      migrateLegacy: () => false,
    });

    assert.equal(resolution.source, "legacy-fallback");
    assert.equal(resolution.active.sessionConfigDir, legacyDir);
    assert.equal(existsSync(join(tempHome, ".local", "state", "doordash-cli", "cookies.json")), false);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
