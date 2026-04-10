import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SAFE_COMMANDS, assertAllowedFlags, assertSafeCommand } from "./lib.js";
import { commandExitCode, parseArgv, version } from "./cli.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const binPath = join(distDir, "bin.js");

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
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
});

test("argument parsing supports inline, spaced, and meta flags", () => {
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
  assert.match(result.stdout, /man dd-cli/);
  assert.match(result.stdout, /login reuses saved local auth when possible, otherwise first tries same-machine Linux Brave\/Chrome profile import, then attachable signed-in browser sessions, then a temporary Chromium login window\./);
  assert.match(result.stdout, /login auto-detects completion when it can; in the temporary-browser fallback you can also press Enter to force an immediate recheck once the page shows you are signed in\./);
  assert.match(result.stdout, /login exits non-zero if authentication is still not established\./);
  assert.match(result.stdout, /auth-check reports saved-session status and can quietly reuse\/import same-machine Linux Brave\/Chrome profile state or an attachable signed-in browser session unless logout disabled that auto-reuse\./);
  assert.match(result.stdout, /logout clears saved session files and keeps passive browser-session reuse off until the next explicit login attempt\./);
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
  assert.doesNotMatch(readFileSync(ddManPath, "utf8"), /auth-bootstrap/);
  assert.doesNotMatch(readFileSync(ddManPath, "utf8"), /auth-clear/);
  assert.match(readFileSync(ddManPath, "utf8"), /passive\s+browser-session reuse stays disabled until the next explicit/i);
  assert.match(readFileSync(ddManPath, "utf8"), /same-machine Linux Brave\/Chrome browser profile/i);
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

test("legacy auth command invocations point users to login/logout", () => {
  const loginRename = runCli(["auth-bootstrap"]);
  assert.equal(loginRename.status, 1);
  assert.match(loginRename.stderr, /Unsupported command: auth-bootstrap/);
  assert.match(loginRename.stderr, /renamed it to login/);

  const logoutRename = runCli(["auth-clear"]);
  assert.equal(logoutRename.status, 1);
  assert.match(logoutRename.stderr, /Unsupported command: auth-clear/);
  assert.match(logoutRename.stderr, /renamed it to logout/);
});

test("commandExitCode treats failed login results as non-zero without changing read-only auth-check semantics", () => {
  assert.equal(commandExitCode("login", { success: false, isLoggedIn: false }), 1);
  assert.equal(commandExitCode("login", { success: true, isLoggedIn: true }), 0);
  assert.equal(commandExitCode("auth-check", { success: true, isLoggedIn: false }), 0);
});

test("logout clears persisted session artifacts in the active home directory", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "doordash-cli-home-"));
  const sessionDir = join(tempHome, ".config", "striderlabs-mcp-doordash");
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

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.cookiesPath, cookiesPath);
    assert.equal(parsed.storageStatePath, storageStatePath);
    assert.match(parsed.message, /disabled until the next `dd-cli login`/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("blocked commands fail immediately", () => {
  const result = runCli(["checkout"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Blocked command: checkout/);
  assert.match(result.stderr, /existing-order inspection only/);
});

test("safe commands reject unknown flags before touching DoorDash flows", () => {
  const result = runCli(["cart", "--payment-method", "visa"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported flag\(s\) for cart: payment-method/);
});
