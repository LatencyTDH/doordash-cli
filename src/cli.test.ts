import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { EXIT_CODES } from "./automation-contract.js";
import { commandExitCode, loginFailureAsCliError, parseArgv, version } from "./cli.js";
import { SAFE_COMMANDS, assertAllowedFlags, assertSafeCommand } from "./lib.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const binPath = join(distDir, "bin.js");

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function parseJsonText(text: string) {
  return JSON.parse(text) as Record<string, unknown>;
}

async function runLinkedCli(linkName: string, args: string[]) {
  chmodSync(binPath, 0o755);

  const tempDir = await mkdtemp(join(tmpdir(), "doordash-cli-"));
  const linkPath = join(tempDir, linkName);

  try {
    await symlink(binPath, linkPath);
    return spawnSync(linkPath, args, {
      encoding: "utf8",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("safe command allowlist stays cart-safe while adding install helpers", () => {
  assert.deepEqual(SAFE_COMMANDS, [
    "install-browser",
    "doctor",
    "auth-check",
    "login",
    "logout",
    "set-address",
    "search",
    "menu",
    "item",
    "orders",
    "order",
    "add-to-cart",
    "update-cart",
    "cart",
  ]);
});

test("dangerous and renamed legacy commands are rejected with guidance", () => {
  assert.throws(() => assertSafeCommand("checkout"), /Blocked command: checkout/);
  assert.throws(() => assertSafeCommand("place-order"), /Blocked command: place-order/);
  assert.throws(() => assertSafeCommand("track-order"), /Use `orders` or `order --order-id/);
  assert.throws(() => assertSafeCommand("payment"), /Blocked command: payment/);
  assert.throws(() => assertSafeCommand("auth-bootstrap"), /renamed it to login/);
  assert.throws(() => assertSafeCommand("auth-clear"), /renamed it to logout/);
});

test("unsupported flags are rejected before network work runs", () => {
  assert.throws(() => assertAllowedFlags("cart", { payment: "visa" }), /Unsupported flag\(s\) for cart/);
  assert.throws(() => assertAllowedFlags("item", { query: "salmon" }), /Unsupported flag\(s\) for item/);
  assert.throws(() => assertAllowedFlags("orders", { cuisine: "japanese" }), /Unsupported flag\(s\) for orders/);
  assert.doesNotThrow(() => assertAllowedFlags("orders", { json: "true", help: "true" }));
});

test("argument parsing supports inline, spaced, meta flags, and global flags before the command", () => {
  assert.deepEqual(parseArgv(["search", "--query=sushi", "--cuisine", "japanese", "--version"]), {
    command: "search",
    flags: {
      query: "sushi",
      cuisine: "japanese",
      version: "true",
    },
  });

  assert.deepEqual(parseArgv(["-h", "-v"]), {
    command: undefined,
    flags: {
      help: "true",
      version: "true",
    },
  });

  assert.deepEqual(parseArgv(["orders", "--limit=5", "--active-only"]), {
    command: "orders",
    flags: {
      limit: "5",
      "active-only": "true",
    },
  });

  assert.deepEqual(parseArgv(["--json", "auth-check"]), {
    command: "auth-check",
    flags: {
      json: "true",
    },
  });

  assert.deepEqual(parseArgv(["--json=false", "orders", "--limit", "2"]), {
    command: "orders",
    flags: {
      json: "false",
      limit: "2",
    },
  });

  assert.deepEqual(parseArgv(["--json", "false", "orders"]), {
    command: "orders",
    flags: {
      json: "false",
    },
  });
});

test("argument parsing normalizes common Unicode dash flags", () => {
  assert.deepEqual(parseArgv(["—help"]), {
    command: undefined,
    flags: { help: "true" },
  });

  assert.deepEqual(parseArgv(["search", "—query=sushi", "–cuisine", "japanese"]), {
    command: "search",
    flags: {
      query: "sushi",
      cuisine: "japanese",
    },
  });
});

test("help output shows the direct read-only/cart-safe command surface", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`doordash-cli v${version().replace(".", "\\.")}`));
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /dd-cli <command>/);
  assert.match(result.stdout, /doordash-cli <command>/);
  assert.match(result.stdout, /install-browser/);
  assert.match(result.stdout, /login/);
  assert.match(result.stdout, /logout/);
  assert.match(result.stdout, /set-address --address/);
  assert.match(result.stdout, /orders \[--limit 20\] \[--active-only\]/);
  assert.match(result.stdout, /order --order-id/);
  assert.match(result.stdout, /options-json/);
  assert.match(result.stdout, /--version, -v/);
  assert.match(result.stdout, /--json \[true\|false\]/);
  assert.match(result.stdout, /stable automation envelope/i);
  assert.match(result.stdout, /man dd-cli/);
  assert.match(result.stdout, /login reuses saved local auth when possible, otherwise first tries same-machine Chrome\/Brave profile import on supported platforms, then attachable signed-in browser sessions, then a temporary Chromium login window\./);
  assert.match(result.stdout, /login auto-detects completion when it can; in the temporary-browser fallback you can also press Enter to force an immediate recheck once the page shows you are signed in\./);
  assert.match(result.stdout, /login exits non-zero if authentication is still not established\./);
  assert.match(result.stdout, /auth-check reports saved-session status and can quietly reuse\/import same-machine Chrome\/Brave profile state on supported platforms or an attachable signed-in browser session unless logout disabled that auto-reuse\./);
  assert.match(result.stdout, /logout clears saved session files and keeps passive browser-session reuse off until the next explicit login attempt\./);
  assert.match(result.stdout, /DOORDASH_CLI_SESSION_DIR/);
  assert.match(result.stdout, /Out-of-scope commands remain intentionally unsupported/);
  assert.doesNotMatch(result.stdout, /auth-bootstrap/);
  assert.doesNotMatch(result.stdout, /auth-clear/);
  assert.match(result.stdout, /temporary Chromium login window/i);
  assert.doesNotMatch(result.stdout, /Dd-cli/);
});

test("repository ships man pages for the supported lowercase command names", () => {
  const ddManPath = join(distDir, "..", "man", "dd-cli.1");
  const aliasManPath = join(distDir, "..", "man", "doordash-cli.1");

  assert.match(readFileSync(ddManPath, "utf8"), /install-browser/);
  assert.match(readFileSync(ddManPath, "utf8"), /\.B login/);
  assert.match(readFileSync(ddManPath, "utf8"), /--json/);
  assert.match(readFileSync(ddManPath, "utf8"), /automation envelope/i);
  assert.doesNotMatch(readFileSync(ddManPath, "utf8"), /auth-bootstrap/);
  assert.doesNotMatch(readFileSync(ddManPath, "utf8"), /auth-clear/);
  assert.match(readFileSync(ddManPath, "utf8"), /passive\s+browser-session reuse stays disabled until the next explicit/i);
  assert.match(readFileSync(ddManPath, "utf8"), /same-machine (?:signed-in )?(?:Chrome\/Brave|Brave\/Chrome|Chrome or Brave|Brave or Chrome) browser profile/i);
  assert.match(readFileSync(ddManPath, "utf8"), /temporary\s+Chromium\s+window/i);
  assert.doesNotMatch(readFileSync(ddManPath, "utf8"), /Dd-cli/);
  assert.equal(readFileSync(aliasManPath, "utf8").trim(), ".so man1/dd-cli.1");
});

test("-h and no-arg invocation both show usage", () => {
  const shortHelp = runCli(["-h"]);
  assert.equal(shortHelp.status, 0);
  assert.match(shortHelp.stdout, /Usage:/);

  const noArgs = runCli([]);
  assert.equal(noArgs.status, 0);
  assert.match(noArgs.stdout, /Usage:/);
  assert.match(noArgs.stdout, /Run with no arguments to show this help/);
});

test("symlinked entrypoints print help for supported lowercase command names", async () => {
  for (const commandName of ["dd-cli", "doordash-cli"]) {
    const result = await runLinkedCli(commandName, ["--help"]);
    assert.equal(result.status, 0, `${commandName} should exit 0`);
    assert.match(result.stdout, /Usage:/, `${commandName} should print usage`);
    assert.match(result.stdout, /dd-cli <command>/, `${commandName} should print command help`);
  }
});

test("version flag prints the package version", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), version());
});

test("json mode can wrap version and help output without loading runtime deps", () => {
  const versionResult = runCli(["--json", "--version"]);
  assert.equal(versionResult.status, 0);
  assert.equal(versionResult.stderr, "");
  assert.deepEqual(parseJsonText(versionResult.stdout), {
    ok: true,
    data: {
      version: version(),
    },
    meta: {
      command: null,
      exitCode: 0,
      version: version(),
    },
  });

  const helpResult = runCli(["--json", "--help"]);
  assert.equal(helpResult.status, 0);
  assert.equal(helpResult.stderr, "");
  const parsedHelp = parseJsonText(helpResult.stdout);
  assert.equal(parsedHelp.ok, true);
  assert.deepEqual(parsedHelp.meta, {
    command: null,
    exitCode: 0,
    version: version(),
  });
  assert.match(String((parsedHelp.data as { usage?: unknown }).usage ?? ""), /Usage:/);
});

test("legacy auth command invocations point users to login/logout with unsupported-command exit codes", () => {
  const loginRename = runCli(["auth-bootstrap"]);
  assert.equal(loginRename.status, EXIT_CODES.unsupported);
  assert.match(loginRename.stderr, /Unsupported command: auth-bootstrap/);
  assert.match(loginRename.stderr, /renamed it to login/);

  const logoutRename = runCli(["auth-clear"]);
  assert.equal(logoutRename.status, EXIT_CODES.unsupported);
  assert.match(logoutRename.stderr, /Unsupported command: auth-clear/);
  assert.match(logoutRename.stderr, /renamed it to logout/);
});

test("commandExitCode reserves the auth exit code for failed login only", () => {
  assert.equal(commandExitCode("login", { success: false, isLoggedIn: false }), EXIT_CODES.auth);
  assert.equal(commandExitCode("login", { success: true, isLoggedIn: true }), EXIT_CODES.success);
  assert.equal(commandExitCode("auth-check", { success: true, isLoggedIn: false }), EXIT_CODES.success);
});

test("login failure can be represented as a structured auth error", () => {
  const error = loginFailureAsCliError({
    success: false,
    isLoggedIn: false,
    message: "Finish signing in, then rerun dd-cli login.",
    email: null,
    consumerId: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  });

  assert.ok(error);
  assert.equal(error?.code, "auth_failed");
  assert.equal(error?.kind, "auth");
  assert.equal(error?.message, "Finish signing in, then rerun dd-cli login.");
});

test("logout clears persisted session artifacts in the active home directory", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "doordash-cli-home-"));
  const sessionDir = join(tempHome, ".local", "state", "doordash-cli");
  const cookiesPath = join(sessionDir, "cookies.json");
  const storageStatePath = join(sessionDir, "storage-state.json");
  const browserImportBlockPath = join(sessionDir, "browser-import-blocked");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(cookiesPath, JSON.stringify([{ name: "session", domain: ".doordash.com" }]));
  writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }));

  try {
    const result = runCli(["logout"], { HOME: tempHome });
    assert.equal(result.status, 0);
    assert.equal(existsSync(cookiesPath), false);
    assert.equal(existsSync(storageStatePath), false);
    assert.equal(existsSync(browserImportBlockPath), true);

    const parsed = parseJsonText(result.stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.cookiesPath, cookiesPath);
    assert.equal(parsed.storageStatePath, storageStatePath);
    assert.match(String(parsed.message ?? ""), /disabled until the next `dd-cli login`/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("json mode wraps logout success in a stable automation envelope", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "doordash-cli-json-home-"));
  const sessionDir = join(tempHome, ".config", "striderlabs-mcp-doordash");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "cookies.json"), JSON.stringify([{ name: "session", domain: ".doordash.com" }]));
  writeFileSync(join(sessionDir, "storage-state.json"), JSON.stringify({ cookies: [], origins: [] }));

  try {
    const result = runCli(["--json", "logout"], { HOME: tempHome });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");

    const parsed = parseJsonText(result.stdout);
    assert.deepEqual(parsed.meta, {
      command: "logout",
      exitCode: 0,
      version: version(),
    });
    assert.equal(parsed.ok, true);
    assert.equal((parsed.data as { success?: unknown }).success, true);
    assert.match(String((parsed.data as { message?: unknown }).message ?? ""), /disabled until the next `dd-cli login`/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("blocked commands fail immediately with dedicated exit codes", () => {
  const result = runCli(["checkout"]);
  assert.equal(result.status, EXIT_CODES.unsupported);
  assert.match(result.stderr, /Blocked command: checkout/);
  assert.match(result.stderr, /existing-order inspection only/);
});

test("safe commands reject unknown flags before touching DoorDash flows", () => {
  const result = runCli(["cart", "--payment-method", "visa"]);
  assert.equal(result.status, EXIT_CODES.usage);
  assert.match(result.stderr, /Unsupported flag\(s\) for cart: payment-method/);
  assert.match(result.stderr, /Usage:/);
});

test("json mode reports unsupported flags as structured machine-readable errors", () => {
  const result = runCli(["--json", "cart", "--payment-method", "visa"]);
  assert.equal(result.status, EXIT_CODES.usage);
  assert.equal(result.stdout, "");

  const parsed = parseJsonText(result.stderr);
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.meta, {
    command: "cart",
    exitCode: EXIT_CODES.usage,
    version: version(),
  });
  assert.equal((parsed.error as { code?: unknown }).code, "unsupported_flag");
  assert.match(String((parsed.error as { message?: unknown }).message ?? ""), /Unsupported flag\(s\) for cart: payment-method/);
  assert.deepEqual((parsed.error as { details?: { unsupportedFlags?: unknown } }).details?.unsupportedFlags, ["payment-method"]);
});

test("json mode reports unsupported legacy commands as structured machine-readable errors", () => {
  const result = runCli(["--json", "auth-bootstrap"]);
  assert.equal(result.status, EXIT_CODES.unsupported);
  assert.equal(result.stdout, "");

  const parsed = parseJsonText(result.stderr);
  assert.equal(parsed.ok, false);
  assert.equal((parsed.error as { code?: unknown }).code, "unsupported_command");
  assert.match(String((parsed.error as { message?: unknown }).message ?? ""), /renamed it to login/);
  assert.deepEqual(parsed.meta, {
    command: "auth-bootstrap",
    exitCode: EXIT_CODES.unsupported,
    version: version(),
  });
});
