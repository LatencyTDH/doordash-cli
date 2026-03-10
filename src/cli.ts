#!/usr/bin/env node
import { SAFE_COMMANDS, assertSafeCommand, runCommand, shutdown } from "./lib.js";

function usage(): string {
  return [
    "dd <command> [flags]",
    "",
    "Safe commands:",
    "  auth-check",
    "  auth-clear",
    "  set-address --address \"123 Main St, City, ST ZIP\"",
    "  search --query sushi [--cuisine japanese]",
    "  menu --restaurant-id 123456",
    "  add-to-cart --restaurant-id 123456 --item-name \"Spicy Tuna Roll\" [--quantity 2] [--special-instructions \"no wasabi\"]",
    "  cart",
    "",
    "Dangerous commands are intentionally unsupported:",
    "  checkout, place-order, track-order, payment actions",
    "",
    `Allowed commands: ${SAFE_COMMANDS.join(", ")}`,
  ].join("\n");
}

function parseArgv(argv: string[]): { command?: string; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    if (!key) {
      throw new Error("Empty flag name");
    }
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
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
    process.exit(0);
  }

  assertSafeCommand(command);

  try {
    const result = await runCommand(command, flags);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success === false ? 1 : 0);
  } finally {
    await shutdown();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  await shutdown().catch(() => {});
  process.exit(1);
});
