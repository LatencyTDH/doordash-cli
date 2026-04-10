#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliError,
  EXIT_CODES,
  buildAutomationErrorEnvelope,
  buildAutomationSuccessEnvelope,
  exitCodeForCliError,
  parseJsonFlag,
  shouldPrintUsage,
  toCliError,
} from "./automation-contract.js";

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
    "  --json [true|false]",
    "",
    "Safe commands:",
    "  install-browser",
    "  doctor [--json]",
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
    "  - --json wraps supported output in a stable automation envelope with explicit error codes and exit codes.",
    "  - Common Unicode long dashes are normalized for flags, so —help / –help work too.",
    "  - Installed command names are lowercase only: dd-cli and doordash-cli.",
    "  - install-browser downloads the bundled Playwright Chromium runtime used when the CLI needs a local browser.",
    "  - doctor is read-only, safe to paste, and defaults to actionable human output; add --json for automation or issue reports.",
    "  - Manual pages ship with the project: man dd-cli or man doordash-cli.",
    "  - login reuses saved local auth when possible, otherwise first tries same-machine Chrome/Brave profile import on supported platforms, then attachable signed-in browser sessions, then a temporary Chromium login window.",
    "  - login auto-detects completion when it can; in the temporary-browser fallback you can also press Enter to force an immediate recheck once the page shows you are signed in.",
    "  - login exits non-zero if authentication is still not established.",
    "  - auth-check reports saved-session status and can quietly reuse/import same-machine Chrome/Brave profile state on supported platforms or an attachable signed-in browser session unless logout disabled that auto-reuse.",
    "  - logout clears saved session files and keeps passive browser-session reuse off until the next explicit login attempt.",
    "  - session files live in a doordash-cli-owned app state directory; set DOORDASH_CLI_SESSION_DIR to override it.",
    "  - configurable items require explicit --options-json selections.",
    "  - unsupported option trees fail closed.",
    "",
    "Out-of-scope commands remain intentionally unsupported:",
    "  checkout, place-order, payment actions, order mutation/cancellation",
    "",
    "Examples:",
    "  dd-cli --help",
    "  dd-cli --json auth-check",
    "  dd-cli install-browser",
    "  dd-cli doctor",
    "  dd-cli search --query sushi",
    "  dd-cli orders --active-only",
    "  doordash-cli order --order-id 3f4c6d0e-1234-5678-90ab-cdef12345678",
    "  doordash-cli login",
    "  doordash-cli doctor --json",
    "",
    "Allowed commands: install-browser, doctor, auth-check, login, logout, set-address, search, menu, item, orders, order, add-to-cart, update-cart, cart",
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

  for (let i = 0; i < tokens.length; i += 1) {
    const rawToken = tokens[i];
    if (rawToken === undefined) {
      throw CliError.usage("usage_error", "Unexpected empty argument");
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

    if (token === "--json") {
      const next = tokens[i + 1];
      if (next === undefined || looksLikeFlagToken(next)) {
        flags.json = "true";
        continue;
      }

      if (command === undefined && !next.startsWith("-")) {
        const normalizedNext = next.trim().toLowerCase();
        if (!["true", "1", "yes", "on", "false", "0", "no", "off"].includes(normalizedNext)) {
          flags.json = "true";
          continue;
        }
      }

      flags.json = next;
      i += 1;
      continue;
    }

    if (!token.startsWith("--")) {
      if (command === undefined) {
        command = rawToken;
        continue;
      }

      throw CliError.usage("usage_error", `Unexpected positional argument: ${rawToken}`, {
        token: rawToken,
      });
    }

    const inlineEquals = token.indexOf("=");
    if (inlineEquals !== -1) {
      const key = token.slice(2, inlineEquals);
      if (!key) {
        throw CliError.usage("usage_error", "Empty flag name");
      }
      flags[key] = token.slice(inlineEquals + 1);
      continue;
    }

    const key = token.slice(2);
    if (!key) {
      throw CliError.usage("usage_error", "Empty flag name");
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
      return EXIT_CODES.auth;
    }
  }

  return EXIT_CODES.success;
}

export function loginFailureAsCliError(result: unknown): CliError | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const authResult = result as {
    success?: unknown;
    isLoggedIn?: unknown;
    message?: unknown;
    email?: unknown;
    consumerId?: unknown;
    cookiesPath?: unknown;
    storageStatePath?: unknown;
  };

  if (authResult.success !== false && authResult.isLoggedIn !== false) {
    return null;
  }

  return CliError.auth(
    typeof authResult.message === "string" && authResult.message.length > 0
      ? authResult.message
      : "DoorDash authentication was not established.",
    {
      auth: {
        isLoggedIn: authResult.isLoggedIn === true,
        email: typeof authResult.email === "string" ? authResult.email : null,
        consumerId: typeof authResult.consumerId === "string" ? authResult.consumerId : null,
        cookiesPath: typeof authResult.cookiesPath === "string" ? authResult.cookiesPath : null,
        storageStatePath: typeof authResult.storageStatePath === "string" ? authResult.storageStatePath : null,
      },
    },
  );
}

export function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

export async function renderCommandOutput(
  command: string,
  flags: Record<string, string>,
  result: unknown,
): Promise<string> {
  if (command === "doctor" && !isTruthyFlag(flags.json)) {
    const { formatDoctorReport } = await import("./doctor.js");
    return formatDoctorReport(result as import("./doctor.js").DoctorResult);
  }

  return JSON.stringify(result, null, 2);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArgv(argv);
  const jsonMode = parseJsonFlag(flags.json);

  if (flags.version === "true") {
    if (jsonMode) {
      console.log(JSON.stringify(buildAutomationSuccessEnvelope({ command: null, version: version(), data: { version: version() } }), null, 2));
      return;
    }

    console.log(version());
    return;
  }

  if (!command || command === "help" || flags.help === "true") {
    if (jsonMode) {
      console.log(JSON.stringify(buildAutomationSuccessEnvelope({ command: command ?? null, version: version(), data: { usage: usage() } }), null, 2));
      return;
    }

    console.log(usage());
    return;
  }

  const lib: typeof import("./lib.js") = await import("./lib.js");
  lib.assertSafeCommand(command);
  const safeCommand: import("./lib.js").SafeCommand = command;

  try {
    const result = await lib.runCommand(safeCommand, flags);
    const loginFailure = loginFailureAsCliError(result);
    if (loginFailure) {
      if (jsonMode) {
        console.error(JSON.stringify(buildAutomationErrorEnvelope({ command: safeCommand, version: version(), error: loginFailure }), null, 2));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      process.exitCode = exitCodeForCliError(loginFailure);
      return;
    }

    if (jsonMode) {
      console.log(JSON.stringify(buildAutomationSuccessEnvelope({ command: safeCommand, version: version(), data: result }), null, 2));
    } else {
      console.log(await renderCommandOutput(safeCommand, flags, result));
    }
    process.exitCode = commandExitCode(safeCommand, result);
  } finally {
    await lib.shutdown();
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  let jsonMode = false;
  let parsedCommand: string | null = null;

  try {
    const parsed = parseArgv(argv);
    parsedCommand = parsed.command ?? null;
    jsonMode = parseJsonFlag(parsed.flags.json);
    await main(argv);
  } catch (error) {
    const cliError = toCliError(error, parsedCommand);

    if (jsonMode) {
      console.error(JSON.stringify(buildAutomationErrorEnvelope({ command: parsedCommand, version: version(), error: cliError }), null, 2));
    } else {
      console.error(cliError.message);
      if (shouldPrintUsage(cliError)) {
        console.error(`\n${usage()}`);
      }
    }

    try {
      const { shutdown } = await import("./lib.js");
      await shutdown().catch(() => {});
    } catch {
      // Help/no-arg flows should work even if runtime deps are unavailable.
    }

    process.exitCode = exitCodeForCliError(cliError);
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
