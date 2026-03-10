#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_COMMANDS, assertSafeCommand, runCommand, shutdown } from "./lib.js";

export function usage(): string {
  return [
    "doordash-cli <command> [flags]",
    "",
    "Safe commands:",
    "  auth-check",
    "  auth-bootstrap",
    "  auth-clear",
    '  set-address --address "350 5th Ave, New York, NY 10118"',
    "  search --query sushi [--cuisine japanese]",
    "  menu --restaurant-id 123456",
    "  item --restaurant-id 123456 --item-id 7890",
    '  add-to-cart --restaurant-id 123456 (--item-id 7890 | --item-name "Spicy Tuna Roll") [--quantity 2] [--special-instructions "no wasabi"] [--options-json "[{\"groupId\":\"703393388\",\"optionId\":\"4716032529\"}]"]',
    "  update-cart --cart-item-id abc123 --quantity 2",
    "  cart",
    "",
    "Notes:",
    "  - Direct GraphQL/HTTP is the default path for auth-check, set-address, search, menu, item, cart, add-to-cart, and update-cart.",
    "  - auth-check automatically imports a signed-in OpenClaw managed-browser DoorDash session when one is available.",
    "  - set-address currently persists only addresses already present in your DoorDash address book; brand-new address enrollment still fails closed.",
    "  - configurable items require explicit --options-json selections and fail closed on nested cursor-driven option trees.",
    "",
    "Dangerous commands are intentionally unsupported:",
    "  checkout, place-order, track-order, payment actions",
    "",
    `Allowed commands: ${SAFE_COMMANDS.join(", ")}`,
  ].join("\n");
}

export function parseArgv(argv: string[]): { command?: string; flags: Record<string, string> } {
  const tokens = [...argv];
  const flags: Record<string, string> = {};

  let command: string | undefined;
  if (tokens[0] !== undefined && !tokens[0].startsWith("-")) {
    command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      throw new Error("Unexpected empty argument");
    }

    if (token === "-h" || token === "--help") {
      flags.help = "true";
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const inlineEquals = token.indexOf("=");
    if (inlineEquals !== -1) {
      const key = token.slice(2, inlineEquals);
      if (!key) {
        throw new Error("Empty flag name");
      }
      flags[key] = token.slice(inlineEquals + 1);
      continue;
    }

    const key = token.slice(2);
    if (!key) {
      throw new Error("Empty flag name");
    }

    const next = tokens[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { command, flags };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgv(process.argv.slice(2));

  if (!command || command === "help" || flags.help === "true") {
    console.log(usage());
    return;
  }

  assertSafeCommand(command);

  try {
    const result = await runCommand(command, flags);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } finally {
    await shutdown();
  }
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }

  return resolve(invokedPath) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  void main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${usage()}`);
    await shutdown().catch(() => {});
    process.exitCode = 1;
  });
}
