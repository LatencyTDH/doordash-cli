import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SAFE_COMMANDS, assertAllowedFlags, assertSafeCommand } from "./lib.js";
import { parseArgv } from "./cli.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
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

test("help output shows the direct cart-safe command surface", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /doordash-cli <command>/);
  assert.match(result.stdout, /auth-bootstrap/);
  assert.match(result.stdout, /set-address --address/);
  assert.match(result.stdout, /options-json/);
  assert.match(result.stdout, /Dangerous commands are intentionally unsupported/);
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
