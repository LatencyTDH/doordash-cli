import { cleanup as browserCleanup } from "@striderlabs/mcp-doordash/dist/browser.js";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  addToCartDirect,
  bootstrapAuthSession,
  checkAuthDirect,
  cleanupDirect,
  clearStoredSession,
  getCartDirect,
  getItemDirect,
  getMenuDirect,
  getOrderDirect,
  getOrdersDirect,
  parseOptionSelectionsJson,
  searchRestaurantsDirect,
  setAddressDirect,
  updateCartDirect,
  type AddToCartResult,
  type AuthBootstrapResult,
  type AuthResult,
  type CartResult,
  type ItemResult,
  type MenuResult,
  type OrderResult,
  type OrdersResult,
  type SearchResult,
  type SetAddressResult,
  type UpdateCartResult,
} from "./direct-api.js";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CLI_PATH = join(dirname(require.resolve("playwright/package.json")), "cli.js");

export const SAFE_COMMANDS = [
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
] as const;

export const BLOCKED_COMMANDS = [
  "checkout",
  "place-order",
  "track-order",
  "payment",
  "pay",
  "tip",
  "submit-order",
] as const;

export type SafeCommand = (typeof SAFE_COMMANDS)[number];
export type CommandFlags = Record<string, string>;

const LEGACY_COMMAND_RENAMES = {
  "auth-bootstrap": "login",
  "auth-clear": "logout",
} as const;

const COMMAND_FLAGS = {
  "install-browser": [],
  "auth-check": [],
  login: [],
  logout: [],
  "set-address": ["address"],
  search: ["query", "cuisine"],
  menu: ["restaurant-id"],
  item: ["restaurant-id", "item-id"],
  orders: ["limit", "active-only"],
  order: ["order-id"],
  "add-to-cart": ["restaurant-id", "item-id", "item-name", "quantity", "special-instructions", "options-json"],
  "update-cart": ["cart-item-id", "quantity"],
  cart: [],
} as const satisfies Record<SafeCommand, readonly string[]>;

export type CommandResult =
  | { success: true; message: string; browser: "chromium" }
  | AuthResult
  | AuthBootstrapResult
  | { success: true; message: string; cookiesPath: string; storageStatePath: string }
  | SetAddressResult
  | SearchResult
  | MenuResult
  | ItemResult
  | OrdersResult
  | OrderResult
  | AddToCartResult
  | UpdateCartResult
  | CartResult;

export function isSafeCommand(value: string): value is SafeCommand {
  return (SAFE_COMMANDS as readonly string[]).includes(value);
}

export function isBlockedCommand(value: string): value is (typeof BLOCKED_COMMANDS)[number] {
  return (BLOCKED_COMMANDS as readonly string[]).includes(value);
}

export function assertSafeCommand(value: string): asserts value is SafeCommand {
  if (isSafeCommand(value)) {
    return;
  }

  if (isBlockedCommand(value)) {
    const guidance = value === "track-order" ? " Use `orders` or `order --order-id ...` for read-only existing-order status instead." : "";
    throw new Error(
      `Blocked command: ${value}. This CLI is read-only for browse, cart, and existing-order inspection only; checkout, order placement, and payment actions stay out of scope.${guidance}`,
    );
  }

  const renamedTo = LEGACY_COMMAND_RENAMES[value as keyof typeof LEGACY_COMMAND_RENAMES];
  if (renamedTo) {
    throw new Error(`Unsupported command: ${value}. This CLI renamed it to ${renamedTo}.`);
  }

  throw new Error(`Unsupported command: ${value}. Allowed commands: ${SAFE_COMMANDS.join(", ")}`);
}

export function assertAllowedFlags(command: SafeCommand, args: CommandFlags): void {
  const allowedFlags = new Set<string>(COMMAND_FLAGS[command]);
  const unknownFlags = Object.keys(args).filter((key) => key !== "help" && !allowedFlags.has(key));

  if (unknownFlags.length === 0) {
    return;
  }

  const allowedText = COMMAND_FLAGS[command].length > 0 ? COMMAND_FLAGS[command].join(", ") : "(none)";
  throw new Error(`Unsupported flag(s) for ${command}: ${unknownFlags.join(", ")}. Allowed flags: ${allowedText}`);
}

export async function runCommand(command: SafeCommand, args: CommandFlags): Promise<CommandResult> {
  assertAllowedFlags(command, args);

  switch (command) {
    case "install-browser":
      return installBrowser();

    case "auth-check":
      return checkAuthDirect();

    case "login":
      return bootstrapAuthSession();

    case "logout":
      return clearStoredSession();

    case "set-address": {
      const address = requiredArg(args, "address");
      return setAddressDirect(address);
    }

    case "search": {
      const query = requiredArg(args, "query");
      const cuisine = optionalArg(args, "cuisine");
      return searchRestaurantsDirect(query, cuisine);
    }

    case "menu": {
      const restaurantId = requiredArg(args, "restaurant-id");
      return getMenuDirect(restaurantId);
    }

    case "item": {
      const restaurantId = requiredArg(args, "restaurant-id");
      const itemId = requiredArg(args, "item-id");
      return getItemDirect(restaurantId, itemId);
    }

    case "orders": {
      const limitRaw = optionalArg(args, "limit");
      const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
      if (limitRaw !== undefined && (!Number.isInteger(limit) || (limit ?? 0) < 1)) {
        throw new Error(`Invalid --limit: ${limitRaw}`);
      }

      return getOrdersDirect({
        limit,
        activeOnly: parseBooleanFlag(optionalArg(args, "active-only"), "active-only") ?? false,
      });
    }

    case "order": {
      const orderId = requiredArg(args, "order-id");
      return getOrderDirect(orderId);
    }

    case "add-to-cart": {
      const restaurantId = requiredArg(args, "restaurant-id");
      const itemId = optionalArg(args, "item-id");
      const itemName = optionalArg(args, "item-name");
      const quantityRaw = optionalArg(args, "quantity");
      const specialInstructions = optionalArg(args, "special-instructions");
      const optionsJson = optionalArg(args, "options-json");
      const quantity = quantityRaw === undefined ? 1 : Number.parseInt(quantityRaw, 10);

      if (!itemId && !itemName) {
        throw new Error("Missing required flag --item-id or --item-name");
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid --quantity: ${quantityRaw}`);
      }

      return addToCartDirect({
        restaurantId,
        itemId,
        itemName,
        quantity,
        specialInstructions,
        optionSelections: optionsJson ? parseOptionSelectionsJson(optionsJson) : [],
      });
    }

    case "update-cart": {
      const cartItemId = requiredArg(args, "cart-item-id");
      const quantityRaw = requiredArg(args, "quantity");
      const quantity = Number.parseInt(quantityRaw, 10);

      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error(`Invalid --quantity: ${quantityRaw}`);
      }

      return updateCartDirect({
        cartItemId,
        quantity,
      });
    }

    case "cart":
      return getCartDirect();
  }
}

export async function shutdown(): Promise<void> {
  await cleanupDirect().catch(() => {});
  await browserCleanup().catch(() => {});
}

async function installBrowser(): Promise<{ success: true; message: string; browser: "chromium" }> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI_PATH, "install", "chromium"], {
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Playwright browser install failed (code=${code ?? "null"}, signal=${signal ?? "none"})`));
    });
  });

  return {
    success: true,
    browser: "chromium",
    message: "Chromium is installed for doordash-cli.",
  };
}

function requiredArg(args: CommandFlags, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function optionalArg(args: CommandFlags, key: string): string | undefined {
  const value = args[key];
  return value && value.length > 0 ? value : undefined;
}

function parseBooleanFlag(value: string | undefined, key: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid --${key}: ${value}. Expected true or false.`);
}
