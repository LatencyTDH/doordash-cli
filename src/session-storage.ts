import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SESSION_DIR_ENV_KEYS = ["DOORDASH_CLI_SESSION_DIR", "DOORDASH_CLI_CONFIG_DIR"] as const;
const SESSION_DIR_NAME = "doordash-cli";
const LEGACY_SESSION_DIR_NAME = "striderlabs-mcp-doordash";
const COOKIES_FILE_NAME = "cookies.json";
const STORAGE_STATE_FILE_NAME = "storage-state.json";
const BROWSER_IMPORT_BLOCK_FILE_NAME = "browser-import-blocked";

export type SessionStorageContext = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  fileExists?: (path: string) => boolean;
  migrateLegacy?: (input: { canonical: SessionStoragePaths; legacy: SessionStoragePaths }) => boolean;
};

export type SessionStoragePaths = {
  sessionConfigDir: string;
  cookiesPath: string;
  storageStatePath: string;
  browserImportBlockPath: string;
};

export type SessionStorageResolution = {
  active: SessionStoragePaths;
  canonical: SessionStoragePaths;
  legacy: SessionStoragePaths;
  source: "override" | "canonical" | "migrated-legacy" | "legacy-fallback";
  overrideDir: string | null;
};

function buildSessionStoragePaths(sessionConfigDir: string): SessionStoragePaths {
  return {
    sessionConfigDir,
    cookiesPath: join(sessionConfigDir, COOKIES_FILE_NAME),
    storageStatePath: join(sessionConfigDir, STORAGE_STATE_FILE_NAME),
    browserImportBlockPath: join(sessionConfigDir, BROWSER_IMPORT_BLOCK_FILE_NAME),
  };
}

function resolveHomeDir(context: SessionStorageContext = {}): string {
  return context.homeDir ?? homedir();
}

function trimEnvValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSessionStorageOverrideDir(context: SessionStorageContext = {}): string | null {
  const env = context.env ?? process.env;
  for (const key of SESSION_DIR_ENV_KEYS) {
    const value = trimEnvValue(env[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

export function resolveCanonicalSessionConfigDir(context: SessionStorageContext = {}): string {
  const overrideDir = resolveSessionStorageOverrideDir(context);
  if (overrideDir) {
    return overrideDir;
  }

  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const homeDir = resolveHomeDir(context);

  if (platform === "win32") {
    const appDataDir = trimEnvValue(env.APPDATA) ?? join(trimEnvValue(env.USERPROFILE) ?? homeDir, "AppData", "Roaming");
    return join(appDataDir, SESSION_DIR_NAME);
  }

  if (platform === "darwin") {
    return join(homeDir, "Library", "Application Support", SESSION_DIR_NAME);
  }

  const xdgStateHome = trimEnvValue(env.XDG_STATE_HOME);
  if (xdgStateHome) {
    return join(xdgStateHome, SESSION_DIR_NAME);
  }

  const xdgConfigHome = trimEnvValue(env.XDG_CONFIG_HOME);
  if (xdgConfigHome) {
    return join(xdgConfigHome, SESSION_DIR_NAME);
  }

  return join(homeDir, ".local", "state", SESSION_DIR_NAME);
}

export function resolveLegacySessionConfigDir(context: SessionStorageContext = {}): string {
  return join(resolveHomeDir(context), ".config", LEGACY_SESSION_DIR_NAME);
}

function hasAnySessionArtifacts(paths: SessionStoragePaths, fileExists: (path: string) => boolean): boolean {
  return [paths.cookiesPath, paths.storageStatePath, paths.browserImportBlockPath].some((path) => fileExists(path));
}

function tryMigrateLegacySessionStorage(input: { canonical: SessionStoragePaths; legacy: SessionStoragePaths }): boolean {
  if (hasAnySessionArtifacts(input.canonical, existsSync)) {
    return true;
  }

  if (!hasAnySessionArtifacts(input.legacy, existsSync)) {
    return false;
  }

  try {
    mkdirSync(input.canonical.sessionConfigDir, { recursive: true });

    for (const [sourcePath, targetPath] of [
      [input.legacy.cookiesPath, input.canonical.cookiesPath],
      [input.legacy.storageStatePath, input.canonical.storageStatePath],
      [input.legacy.browserImportBlockPath, input.canonical.browserImportBlockPath],
    ] as const) {
      if (existsSync(sourcePath) && !existsSync(targetPath)) {
        copyFileSync(sourcePath, targetPath);
      }
    }

    return hasAnySessionArtifacts(input.canonical, existsSync);
  } catch {
    return false;
  }
}

export function resolveSessionStoragePaths(context: SessionStorageContext = {}): SessionStorageResolution {
  const canonical = buildSessionStoragePaths(resolveCanonicalSessionConfigDir(context));
  const legacy = buildSessionStoragePaths(resolveLegacySessionConfigDir(context));
  const overrideDir = resolveSessionStorageOverrideDir(context);

  if (overrideDir) {
    return {
      active: canonical,
      canonical,
      legacy,
      source: "override",
      overrideDir,
    };
  }

  const fileExists = context.fileExists ?? existsSync;
  if (hasAnySessionArtifacts(canonical, fileExists)) {
    return {
      active: canonical,
      canonical,
      legacy,
      source: "canonical",
      overrideDir: null,
    };
  }

  if (hasAnySessionArtifacts(legacy, fileExists)) {
    const migrated = (context.migrateLegacy ?? tryMigrateLegacySessionStorage)({ canonical, legacy });
    return {
      active: migrated ? canonical : legacy,
      canonical,
      legacy,
      source: migrated ? "migrated-legacy" : "legacy-fallback",
      overrideDir: null,
    };
  }

  return {
    active: canonical,
    canonical,
    legacy,
    source: "canonical",
    overrideDir: null,
  };
}

export function getSessionConfigDir(): string {
  return resolveSessionStoragePaths().active.sessionConfigDir;
}

export function getCookiesPath(): string {
  return resolveSessionStoragePaths().active.cookiesPath;
}

export function getStorageStatePath(): string {
  return resolveSessionStoragePaths().active.storageStatePath;
}

export function getBrowserImportBlockPath(): string {
  return resolveSessionStoragePaths().active.browserImportBlockPath;
}
