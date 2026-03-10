import {
  addToCart,
  checkAuth,
  getCart,
  getMenu,
  searchRestaurants,
  setAddress,
  cleanup,
} from "@striderlabs/mcp-doordash/dist/browser.js";
import {
  clearCookies,
  getCookiesPath,
  hasStoredCookies,
} from "@striderlabs/mcp-doordash/dist/auth.js";

export const SAFE_COMMANDS = [
  "auth-check",
  "auth-clear",
  "set-address",
  "search",
  "menu",
  "add-to-cart",
  "cart",
] as const;

export type SafeCommand = (typeof SAFE_COMMANDS)[number];

export function isSafeCommand(value: string): value is SafeCommand {
  return (SAFE_COMMANDS as readonly string[]).includes(value);
}

export function assertSafeCommand(value: string): asserts value is SafeCommand {
  if (!isSafeCommand(value)) {
    throw new Error(
      `Unsupported or dangerous command: ${value}. Allowed commands: ${SAFE_COMMANDS.join(", ")}`,
    );
  }
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export async function runCommand(command: SafeCommand, args: Record<string, string>): Promise<JsonObject> {
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
      return await setAddress(address);
    }

    case "search": {
      const query = requiredArg(args, "query");
      const cuisine = optionalArg(args, "cuisine");
      return await searchRestaurants(query, cuisine ? { cuisine } : undefined);
    }

    case "menu": {
      const restaurantId = requiredArg(args, "restaurant-id");
      return await getMenu(restaurantId);
    }

    case "add-to-cart": {
      const restaurantId = requiredArg(args, "restaurant-id");
      const itemName = requiredArg(args, "item-name");
      const quantityRaw = optionalArg(args, "quantity");
      const specialInstructions = optionalArg(args, "special-instructions");
      const quantity = quantityRaw ? Number.parseInt(quantityRaw, 10) : 1;
      if (!Number.isFinite(quantity) || quantity < 1) {
        throw new Error(`Invalid --quantity: ${quantityRaw}`);
      }
      return await addToCart(restaurantId, itemName, quantity, specialInstructions);
    }

    case "cart": {
      return await getCart();
    }
  }
}

export async function shutdown(): Promise<void> {
  await cleanup();
}

function requiredArg(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function optionalArg(args: Record<string, string>, key: string): string | undefined {
  const value = args[key];
  return value && value.length > 0 ? value : undefined;
}
