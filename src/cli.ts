#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_DASH_PREFIX = /^[\u2012\u2013\u2014\u2015\u2212]+/u;
const FLAG_BODY = /^[A-Za-z0-9][A-Za-z0-9-]*(=.*)?$/;

const PACKAGE_JSON_PATH = new URL("../package.json", import.meta.url);
const PACKAGE_VERSION = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).version as string;

export function version(): string {
  return PACKAGE_VERSION;
}

export function usage(): string {
  return [
    `doordash-cli v${version()}`,
    "",
    "Usage:",
    "  dd-cli <command> [flags]",
    "  doordash-cli <command> [flags]",
    "",
    "Meta:",
    "  --help, -h",
    "  --version, -v",
    "",
    "Safe commands:",
    "  install-browser",
    "  auth-check",
    "  login",
    "  logout",
    '  set-address --address "350 5th Ave, New York, NY 10118"',
    "  search --query sushi [--cuisine japanese]",
    "  menu --restaurant-id 123456",
    "  item --restaurant-id 123456 --item-id 7890",
    "  orders [--limit 20] [--active-only]",
    "  order --order-id 3f4c6d0e-1234-5678-90ab-cdef12345678",
    "  add-to-cart --restaurant-id 123456 (--item-id 7890 | --item-name \"Spicy Tuna Roll\") [--quantity 2] [--special-instructions \"no wasabi\"] [--options-json '[{\"groupId\":\"703393388\",\"optionId\":\"4716032529\"}]']",
    "  update-cart --cart-item-id abc123 --quantity 2",
    "  cart",
    "",
    "Notes:",
    "  - Run with no arguments to show this help.",
    "  - Common Unicode long dashes are normalized for flags, so —help / –help work too.",
    "  - Installed command names are lowercase only: dd-cli and doordash-cli.",
    "  - install-browser downloads the bundled Playwright Chromium runtime used when the CLI needs a local browser.",
    "  - Manual pages ship with the project: man dd-cli or man doordash-cli.",
    "  - login reuses saved local auth when possible, otherwise imports an attachable signed-in browser session or opens a temporary Chromium login window.",
    "  - login auto-detects completion when it can; in the temporary-browser fallback you can also press Enter to force an immediate recheck once the page shows you are signed in.",
    "  - login exits non-zero if authentication is still not established.",
    "  - auth-check reports saved-session status and can quietly reuse/import an attachable signed-in browser session unless logout disabled that auto-reuse.",
    "  - logout clears saved session files and keeps passive browser-session reuse off until the next explicit login attempt.",
    "  - configurable items require explicit --options-json selections.",
    "  - unsupported option trees fail closed.",
    "",
    "Out-of-scope commands remain intentionally unsupported:",
    "  checkout, place-order, payment actions, order mutation/cancellation",
    "",
    "Examples:",
    "  dd-cli --help",
    "  dd-cli install-browser",
    "  dd-cli search --query sushi",
    "  dd-cli orders --active-only",
    "  doordash-cli order --order-id 3f4c6d0e-1234-5678-90ab-cdef12345678",
    "  doordash-cli login",
    "",
    "Allowed commands: install-browser, auth-check, login, logout, set-address, search, menu, item, orders, order, add-to-cart, update-cart, cart",
  ].join("\n");
}

export function normalizeOptionToken(token: string): string {
  const prefix = token.match(UNICODE_DASH_PREFIX)?.[0];
  if (!prefix) {
    return token;
  }

  const body = token.slice(prefix.length);
  if (!FLAG_BODY.test(body)) {
    return token;
  }

  return `${body.length === 1 ? "-" : "--"}${body}`;
}

function looksLikeFlagToken(token: string): boolean {
  return token.startsWith("-") || normalizeOptionToken(token) !== token;
}

export function parseArgv(argv: string[]): { command?: string; flags: Record<string, string> } {
  const tokens = [...argv];
  const flags: Record<string, string> = {};

  let command: string | undefined;
  if (tokens[0] !== undefined && !looksLikeFlagToken(tokens[0])) {
    command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const rawToken = tokens[i];
    if (rawToken === undefined) {
      throw new Error("Unexpected empty argument");
    }

    const token = normalizeOptionToken(rawToken);

    if (token === "-h" || token === "--help") {
      flags.help = "true";
      continue;
    }

    if (token === "-v" || token === "--version") {
      flags.version = "true";
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${rawToken}`);
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
    if (next === undefined || looksLikeFlagToken(next)) {
      flags[key] = "true";
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { command, flags };
}

export function commandExitCode(command: string, result: unknown): number {
  if (command === "login" && typeof result === "object" && result !== null) {
    const authResult = result as { success?: unknown; isLoggedIn?: unknown };
    if (authResult.success === false || authResult.isLoggedIn === false) {
      return 1;
    }
  }

  return 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArgv(argv);

  if (flags.version === "true") {
    console.log(version());
    return;
  }

  if (!command || command === "help" || flags.help === "true") {
    console.log(usage());
    return;
  }

  const lib: typeof import("./lib.js") = await import("./lib.js");
  lib.assertSafeCommand(command);
  const safeCommand: import("./lib.js").SafeCommand = command;

  try {
    const result = await lib.runCommand(safeCommand, flags);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = commandExitCode(safeCommand, result);
  } finally {
    await lib.shutdown();
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await main(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${usage()}`);

    try {
      const { shutdown } = await import("./lib.js");
      await shutdown().catch(() => {});
    } catch {
      // Help/no-arg flows should work even if runtime deps are unavailable.
    }

    process.exitCode = 1;
  }
}

export function isDirectExecution(argv1: string | undefined = process.argv[1], metaUrl: string = import.meta.url): boolean {
  if (!argv1) {
    return false;
  }

  const modulePath = fileURLToPath(metaUrl);

  try {
    return realpathSync(resolve(argv1)) === realpathSync(modulePath);
  } catch {
    return resolve(argv1) === resolve(modulePath);
  }
}

if (isDirectExecution()) {
  void runCli();
}
