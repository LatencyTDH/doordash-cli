import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCookiesPath, getSessionConfigDir, getStorageStatePath } from "./session-storage.js";

test("session storage paths stay compatible with the historical StriderLabs location", () => {
  const configDir = join(homedir(), ".config", "striderlabs-mcp-doordash");

  assert.equal(getSessionConfigDir(), configDir);
  assert.equal(getCookiesPath(), join(configDir, "cookies.json"));
  assert.equal(getStorageStatePath(), join(configDir, "storage-state.json"));
});
