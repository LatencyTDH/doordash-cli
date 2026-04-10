import { homedir } from "node:os";
import { join } from "node:path";

// Keep the historical session location so existing saved DoorDash auth state continues to work
// after removing the external helper dependency.
const SESSION_CONFIG_DIR = join(homedir(), ".config", "striderlabs-mcp-doordash");
const COOKIES_FILE = join(SESSION_CONFIG_DIR, "cookies.json");
const STORAGE_STATE_FILE = join(SESSION_CONFIG_DIR, "storage-state.json");
const BROWSER_IMPORT_BLOCK_FILE = join(SESSION_CONFIG_DIR, "browser-import-blocked");

export function getSessionConfigDir(): string {
  return SESSION_CONFIG_DIR;
}

export function getCookiesPath(): string {
  return COOKIES_FILE;
}

export function getStorageStatePath(): string {
  return STORAGE_STATE_FILE;
}

export function getBrowserImportBlockPath(): string {
  return BROWSER_IMPORT_BLOCK_FILE;
}
