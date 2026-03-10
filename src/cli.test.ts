import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SAFE_COMMANDS, assertAllowedFlags, assertSafeCommand } from "./lib.js";
import { parseArgv } from "./cli.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const binPath = join(distDir, "bin.js");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
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

test("safe command allowlist stays cart-safe while adding direct API helpers", () => {
  assert.deepEqual(SAFE_COMMANDS, [
    "auth-check",
    "auth-bootstrap",
    "auth-clear",
    "set-address",
    "search",
    "menu",
    "item",
    "add-to-cart",
    "update-cart",
    "cart",
  ]);
});

test("dangerous commands are rejected", () => {
  assert.throws(() => assertSafeCommand("checkout"), /Blocked command: checkout/);
  assert.throws(() => assertSafeCommand("place-order"), /Blocked command: place-order/);
  assert.throws(() => assertSafeCommand("track-order"), /Blocked command: track-order/);
  assert.throws(() => assertSafeCommand("payment"), /Blocked command: payment/);
});

test("unsupported flags are rejected before network work runs", () => {
  assert.throws(() => assertAllowedFlags("cart", { payment: "visa" }), /Unsupported flag\(s\) for cart/);
  assert.throws(() => assertAllowedFlags("item", { query: "salmon" }), /Unsupported flag\(s\) for item/);
});

test("argument parsing supports inline and spaced flags", () => {
  assert.deepEqual(parseArgv(["search", "--query=sushi", "--cuisine", "japanese"]), {
    command: "search",
    flags: {
      query: "sushi",
      cuisine: "japanese",
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

test("help output shows the direct cart-safe command surface", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /dd-cli <command>/);
  assert.match(result.stdout, /doordash-cli <command>/);
  assert.match(result.stdout, /auth-bootstrap/);
  assert.match(result.stdout, /set-address --address/);
  assert.match(result.stdout, /options-json/);
  assert.match(result.stdout, /man dd-cli/);
  assert.match(result.stdout, /Dangerous commands are intentionally unsupported/);
  assert.doesNotMatch(result.stdout, /Dd-cli/);
});

test("repository ships man pages for the supported lowercase command names", () => {
  const ddManPath = join(distDir, "..", "man", "dd-cli.1");
  const aliasManPath = join(distDir, "..", "man", "doordash-cli.1");

  assert.match(readFileSync(ddManPath, "utf8"), /\.TH DD-CLI 1/);
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

test("blocked commands fail immediately", () => {
  const result = runCli(["checkout"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Blocked command: checkout/);
  assert.match(result.stderr, /cart-safe only/);
});

test("safe commands reject unknown flags before touching DoorDash flows", () => {
  const result = runCli(["cart", "--payment-method", "visa"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported flag\(s\) for cart: payment-method/);
});
