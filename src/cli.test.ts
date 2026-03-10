import test from "node:test";
import assert from "node:assert/strict";
import { SAFE_COMMANDS, assertSafeCommand } from "./lib.js";

test("safe command allowlist is cart-only", () => {
  assert.deepEqual(SAFE_COMMANDS, [
    "auth-check",
    "auth-clear",
    "set-address",
    "search",
    "menu",
    "add-to-cart",
    "cart",
  ]);
});

test("dangerous commands are rejected", () => {
  assert.throws(() => assertSafeCommand("checkout"), /Unsupported or dangerous command/);
  assert.throws(() => assertSafeCommand("place-order"), /Unsupported or dangerous command/);
  assert.throws(() => assertSafeCommand("track-order"), /Unsupported or dangerous command/);
  assert.throws(() => assertSafeCommand("payment"), /Unsupported or dangerous command/);
});
