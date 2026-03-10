import {
  addToCart,
  checkAuth,
  cleanup,
  getCart,
  getMenu,
  searchRestaurants,
  setAddress,
} from "@striderlabs/mcp-doordash/dist/browser.js";
import { clearCookies, getCookiesPath, hasStoredCookies } from "@striderlabs/mcp-doordash/dist/auth.js";

export const SAFE_COMMANDS = [
  "auth-check",
  "auth-clear",
  "set-address",
  "search",
  "menu",
  "add-to-cart",
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

const COMMAND_FLAGS = {
  "auth-check": [],
  "auth-clear": [],
  "set-address": ["address"],
  search: ["query", "cuisine"],
  menu: ["restaurant-id"],
  "add-to-cart": ["restaurant-id", "item-name", "quantity", "special-instructions"],
  cart: [],
} as const satisfies Record<SafeCommand, readonly string[]>;

export type SafeCommand = (typeof SAFE_COMMANDS)[number];
export type CommandFlags = Record<string, string>;

type AuthCheckNoCookiesResult = {
  success: true;
  isLoggedIn: false;
  message: string;
  cookiesPath: string;
  nextStep: string;
};

type AuthCheckResult = {
  success: true;
  isLoggedIn: boolean;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  cookiesPath: string;
};

type AuthClearResult = {
  success: true;
  message: string;
  cookiesPath: string;
};

type SetAddressResult = Awaited<ReturnType<typeof setAddress>>;
type SearchResult = Awaited<ReturnType<typeof searchRestaurants>>;
type MenuResult = Awaited<ReturnType<typeof getMenu>>;
type AddToCartResult = Awaited<ReturnType<typeof addToCart>>;
type CartResult = Awaited<ReturnType<typeof getCart>>;

export type CommandResult =
  | AuthCheckNoCookiesResult
  | AuthCheckResult
  | AuthClearResult
  | SetAddressResult
  | SearchResult
  | MenuResult
  | AddToCartResult
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
    throw new Error(
      `Blocked command: ${value}. This CLI is cart-safe only and will not expose checkout, order placement, tracking, or payment actions.`,
    );
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
  throw new Error(
    `Unsupported flag(s) for ${command}: ${unknownFlags.join(", ")}. Allowed flags: ${allowedText}`,
  );
}

export async function runCommand(command: SafeCommand, args: CommandFlags): Promise<CommandResult> {
  assertAllowedFlags(command, args);

  switch (command) {
    case "auth-check": {
      if (!hasStoredCookies()) {
        return {
          success: true,
          isLoggedIn: false,
          message: "No stored DoorDash session cookies found.",
          cookiesPath: getCookiesPath(),
          nextStep:
            "Log in to DoorDash manually in a browser, then export/import cookies into the shared cookie file if needed.",
        };
      }

      const authState = await checkAuth();
      return {
        success: true,
        isLoggedIn: authState.isLoggedIn,
        email: authState.email ?? null,
        firstName: authState.firstName ?? null,
        lastName: authState.lastName ?? null,
        cookiesPath: getCookiesPath(),
      };
    }

    case "auth-clear": {
      clearCookies();
      return {
        success: true,
        message: "DoorDash session cookies cleared.",
        cookiesPath: getCookiesPath(),
      };
    }

    case "set-address": {
      const address = requiredArg(args, "address");
      return setAddress(address);
    }

    case "search": {
      const query = requiredArg(args, "query");
      const cuisine = optionalArg(args, "cuisine");
      return searchRestaurants(query, cuisine ? { cuisine } : undefined);
    }

    case "menu": {
      const restaurantId = requiredArg(args, "restaurant-id");
      return getMenu(restaurantId);
    }

    case "add-to-cart": {
      const restaurantId = requiredArg(args, "restaurant-id");
      const itemName = requiredArg(args, "item-name");
      const quantityRaw = optionalArg(args, "quantity");
      const specialInstructions = optionalArg(args, "special-instructions");
      const quantity = quantityRaw === undefined ? 1 : Number.parseInt(quantityRaw, 10);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid --quantity: ${quantityRaw}`);
      }

      return addToCart(restaurantId, itemName, quantity, specialInstructions);
    }

    case "cart": {
      return getCart();
    }
  }
}

export async function shutdown(): Promise<void> {
  await cleanup();
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
