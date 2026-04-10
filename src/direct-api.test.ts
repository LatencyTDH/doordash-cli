import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  bootstrapAuthSessionWithDeps,
  buildAddConsumerAddressPayload,
  buildAddToCartPayload,
  buildUpdateCartPayload,
  extractExistingOrdersFromApolloCache,
  normalizeItemName,
  parseExistingOrderLifecycleStatus,
  parseExistingOrdersResponse,
  parseOptionSelectionsJson,
  parseSearchRestaurantRow,
  preferredBrowserSessionImportStrategies,
  resolveAttachedBrowserCdpCandidates,
  resolveSameMachineChromiumProfileTargets,
  resolveAvailableAddressMatch,
  resolveSystemBrowserOpenCommand,
  selectAttachedBrowserImportMode,
  summarizeDesktopBrowserReuseGap,
  type AuthResult,
  type ItemResult,
} from "./direct-api.js";

function configurableItemDetail(): ItemResult {
  return {
    success: true,
    restaurantId: "1721744",
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "+$18.98",
      unitAmount: 1898,
      currency: "USD",
      decimalPlaces: 2,
      menuId: "2181443",
      specialInstructionsMaxLength: 500,
      dietaryTags: [],
      reviewData: null,
      requiredOptionLists: [
        {
          id: "703393388",
          name: "1st Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716032529",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
        {
          id: "703393389",
          name: "2nd Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716042466",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
      ],
      optionLists: [
        {
          id: "703393388",
          name: "1st Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716032529",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
        {
          id: "703393389",
          name: "2nd Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716042466",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
      ],
      preferences: [],
    },
  };
}

test("normalizeItemName trims and collapses whitespace", () => {
  assert.equal(normalizeItemName("  Sushi   premium "), "sushi premium");
});

test("parseSearchRestaurantRow extracts restaurant metadata from facet rows", () => {
  const row = parseSearchRestaurantRow({
    id: "row.store:24633898:0",
    text: {
      title: "Poke Bowl",
      description: "$$ • Hawaiian, Seafood Restaurant",
      custom: [
        { key: "delivery_fee_string", value: "$0 delivery fee over $7" },
        { key: "eta_display_string", value: "1.0 mi • 32 min" },
        { key: "is_retail", value: "false" },
      ],
    },
    images: {
      main: {
        uri: "https://img.cdn4dd.com/example.jpeg",
      },
    },
    events: {
      click: {
        name: "navigate",
        data: JSON.stringify({ domain: "https://www.doordash.com/", uri: "store/24633898/?pickup=false" }),
      },
    },
    component: {
      id: "row.store",
      category: "row",
    },
  });

  assert.deepEqual(row, {
    id: "24633898",
    name: "Poke Bowl",
    description: "$$ • Hawaiian, Seafood Restaurant",
    cuisines: ["Hawaiian, Seafood Restaurant"],
    isRetail: false,
    eta: "1.0 mi • 32 min",
    deliveryFee: "$0 delivery fee over $7",
    imageUrl: "https://img.cdn4dd.com/example.jpeg",
    url: "https://www.doordash.com/store/24633898/?pickup=false",
  });
});

test("resolveAttachedBrowserCdpCandidates prioritizes explicit envs, compatibility envs, config, and defaults", () => {
  const env = {
    DOORDASH_BROWSER_CDP_URLS: "http://127.0.0.1:9555/, http://127.0.0.1:9556",
    DOORDASH_ATTACHED_BROWSER_CDP_URL: "http://127.0.0.1:9666/",
    DOORDASH_BROWSER_CDP_PORTS: "9333, 9334",
    DOORDASH_BROWSER_CDP_PORT: "9444",
    OPENCLAW_BROWSER_CDP_URL: "http://127.0.0.1:18888/",
  } as NodeJS.ProcessEnv;

  const candidates = resolveAttachedBrowserCdpCandidates(env, ["http://127.0.0.1:9777"]);
  assert.deepEqual(candidates.slice(0, 7), [
    "http://127.0.0.1:9555",
    "http://127.0.0.1:9556",
    "http://127.0.0.1:9666",
    "http://127.0.0.1:9333",
    "http://127.0.0.1:9334",
    "http://127.0.0.1:9444",
    "http://127.0.0.1:18888",
  ]);
  assert.ok(candidates.includes("http://127.0.0.1:9777"));
  assert.ok(candidates.includes("http://127.0.0.1:18792"));
  assert.ok(candidates.includes("http://127.0.0.1:18800"));
  assert.ok(candidates.includes("http://127.0.0.1:9222"));
});

test("resolveSystemBrowserOpenCommand stays generic across operating systems", () => {
  assert.deepEqual(resolveSystemBrowserOpenCommand("https://www.doordash.com/home", "darwin"), {
    command: "open",
    args: ["https://www.doordash.com/home"],
  });
  assert.deepEqual(resolveSystemBrowserOpenCommand("https://www.doordash.com/home", "linux"), {
    command: "xdg-open",
    args: ["https://www.doordash.com/home"],
  });
  assert.deepEqual(resolveSystemBrowserOpenCommand("https://www.doordash.com/home", "win32"), {
    command: "cmd",
    args: ["/c", "start", "", "https://www.doordash.com/home"],
  });
});

test("summarizeDesktopBrowserReuseGap explains why a running Brave session still was not reusable", () => {
  const message = summarizeDesktopBrowserReuseGap({
    processCommands: [
      "/bin/bash /usr/bin/brave-browser-stable",
      "/opt/brave.com/brave/brave",
      "/opt/brave.com/brave/brave --type=renderer",
    ],
    hasAnyDevToolsActivePort: false,
  });

  assert.match(message ?? "", /Brave is already running on this desktop/i);
  assert.match(message ?? "", /couldn't reuse it automatically/i);
  assert.match(message ?? "", /attachable browser automation session/i);
  assert.match(message ?? "", /no importable signed-in DoorDash browser profile state was found/i);
});

test("summarizeDesktopBrowserReuseGap stays quiet once the browser exposes attach signals", () => {
  assert.equal(
    summarizeDesktopBrowserReuseGap({
      processCommands: ["/bin/bash /usr/bin/brave-browser-stable --remote-debugging-port=9222"],
      hasAnyDevToolsActivePort: false,
    }),
    null,
  );
  assert.equal(
    summarizeDesktopBrowserReuseGap({
      processCommands: ["/bin/bash /usr/bin/brave-browser-stable"],
      hasAnyDevToolsActivePort: true,
    }),
    null,
  );
});

test("resolveSameMachineChromiumProfileTargets resolves platform-specific Chrome/Brave profile locations", () => {
  assert.deepEqual(
    resolveSameMachineChromiumProfileTargets({
      platform: "linux",
      homeDir: "/tmp/linux-home",
      env: {} as NodeJS.ProcessEnv,
    }),
    [
      {
        browserLabel: "Brave",
        userDataDir: join("/tmp/linux-home", ".config", "BraveSoftware", "Brave-Browser"),
        importMode: "linux-cookie-db",
        safeStorageApplication: "brave",
        executableCandidates: [],
      },
      {
        browserLabel: "Google Chrome",
        userDataDir: join("/tmp/linux-home", ".config", "google-chrome"),
        importMode: "linux-cookie-db",
        safeStorageApplication: "chrome",
        executableCandidates: [],
      },
    ],
  );

  assert.deepEqual(
    resolveSameMachineChromiumProfileTargets({
      platform: "darwin",
      homeDir: "/Users/example",
      env: {} as NodeJS.ProcessEnv,
    }),
    [
      {
        browserLabel: "Brave",
        userDataDir: join("/Users/example", "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          join("/Users/example", "Applications", "Brave Browser.app", "Contents", "MacOS", "Brave Browser"),
        ],
      },
      {
        browserLabel: "Google Chrome",
        userDataDir: join("/Users/example", "Library", "Application Support", "Google", "Chrome"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join("/Users/example", "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        ],
      },
    ],
  );

  assert.deepEqual(
    resolveSameMachineChromiumProfileTargets({
      platform: "win32",
      homeDir: "C:\\Users\\Example",
      env: {
        LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      } as NodeJS.ProcessEnv,
    }),
    [
      {
        browserLabel: "Brave",
        userDataDir: join("C:\\Users\\Example\\AppData\\Local", "BraveSoftware", "Brave-Browser", "User Data"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          join("C:\\Users\\Example\\AppData\\Local", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
          join("C:\\Program Files", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
          join("C:\\Program Files (x86)", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ],
      },
      {
        browserLabel: "Google Chrome",
        userDataDir: join("C:\\Users\\Example\\AppData\\Local", "Google", "Chrome", "User Data"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          join("C:\\Users\\Example\\AppData\\Local", "Google", "Chrome", "Application", "chrome.exe"),
          join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          join("C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        ],
      },
    ],
  );
});

test("preferredBrowserSessionImportStrategies prefers same-machine profile imports before CDP attach on supported platforms", () => {
  assert.deepEqual(preferredBrowserSessionImportStrategies("linux"), ["same-machine-chromium-profile", "attached-browser-cdp"]);
  assert.deepEqual(preferredBrowserSessionImportStrategies("darwin"), ["same-machine-chromium-profile", "attached-browser-cdp"]);
  assert.deepEqual(preferredBrowserSessionImportStrategies("win32"), ["same-machine-chromium-profile", "attached-browser-cdp"]);
  assert.deepEqual(preferredBrowserSessionImportStrategies("freebsd"), ["attached-browser-cdp"]);
});

test("selectAttachedBrowserImportMode treats an authenticated browser with DoorDash cookies as an immediate import candidate", () => {
  assert.equal(
    selectAttachedBrowserImportMode({
      pageUrls: ["https://github.com/LatencyTDH/doordash-cli/pulls"],
      cookies: [{ domain: ".doordash.com" }],
    }),
    "cookies",
  );
  assert.equal(
    selectAttachedBrowserImportMode({
      pageUrls: ["https://www.doordash.com/home"],
      cookies: [{ domain: ".github.com" }],
    }),
    "page",
  );
  assert.equal(
    selectAttachedBrowserImportMode({
      pageUrls: ["https://github.com/LatencyTDH/doordash-cli"],
      cookies: [{ domain: ".github.com" }],
    }),
    "skip",
  );
});

test("bootstrapAuthSessionWithDeps returns immediately when saved local auth is already valid", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let importCalls = 0;
  let openCalls = 0;
  let waitCalls = 0;
  let markCalls = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => auth,
    importBrowserSessionIfAvailable: async () => {
      importCalls += 1;
      return true;
    },
    markBrowserImportAttempted: () => {
      markCalls += 1;
    },
    getAttachedBrowserCdpCandidates: async () => {
      throw new Error("should not inspect candidates when saved auth is already valid");
    },
    getReachableCdpCandidates: async () => {
      throw new Error("should not probe reachability when saved auth is already valid");
    },
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => {
      throw new Error("should not try to open an attached browser when saved auth is already valid");
    },
    openUrlInDefaultBrowser: async () => {
      openCalls += 1;
      return true;
    },
    waitForAttachedBrowserSessionImport: async () => {
      waitCalls += 1;
      return true;
    },
    waitForManagedBrowserLogin: async () => {
      throw new Error("should not launch a managed browser when saved auth is already valid");
    },
    canPromptForManagedBrowserConfirmation: () => false,
    checkAuthDirect: async () => {
      throw new Error("should not re-check auth through the live session when saved auth is already valid");
    },
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(importCalls, 0);
  assert.equal(markCalls, 0);
  assert.equal(openCalls, 0);
  assert.equal(waitCalls, 0);
  assert.equal(logs.length, 0);
  assert.equal(result.isLoggedIn, true);
  assert.match(result.message, /Already signed in with saved local DoorDash session state/);
});

test("bootstrapAuthSessionWithDeps returns immediately when an attached browser session is already authenticated", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let openCalls = 0;
  let waitCalls = 0;
  let markCalls = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => true,
    markBrowserImportAttempted: () => {
      markCalls += 1;
    },
    getAttachedBrowserCdpCandidates: async () => {
      throw new Error("should not inspect candidates on immediate browser-session import");
    },
    getReachableCdpCandidates: async () => {
      throw new Error("should not probe reachability on immediate browser-session import");
    },
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => {
      throw new Error("should not open a browser when immediate browser-session import succeeded");
    },
    openUrlInDefaultBrowser: async () => {
      openCalls += 1;
      return true;
    },
    waitForAttachedBrowserSessionImport: async () => {
      waitCalls += 1;
      return true;
    },
    waitForManagedBrowserLogin: async () => {
      throw new Error("should not launch a managed browser when immediate browser-session import succeeded");
    },
    canPromptForManagedBrowserConfirmation: () => false,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(markCalls, 1);
  assert.equal(openCalls, 0);
  assert.equal(waitCalls, 0);
  assert.equal(logs.length, 0);
  assert.equal(result.isLoggedIn, true);
  assert.match(result.message, /Imported an existing signed-in browser session/);
});

test("bootstrapAuthSessionWithDeps opens a watchable attached browser session before entering the full wait path", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let openAttachedCalls = 0;
  let openDefaultCalls = 0;
  let waitCalls = 0;
  let reachableCalls = 0;
  let waitTimeoutMs = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => ["http://127.0.0.1:9222"],
    getReachableCdpCandidates: async (candidates) => {
      reachableCalls += 1;
      return candidates;
    },
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => {
      openAttachedCalls += 1;
      return true;
    },
    openUrlInDefaultBrowser: async () => {
      openDefaultCalls += 1;
      return true;
    },
    waitForAttachedBrowserSessionImport: async (input) => {
      waitCalls += 1;
      waitTimeoutMs = input.timeoutMs;
      return true;
    },
    waitForManagedBrowserLogin: async () => {
      throw new Error("should not launch a managed browser when an attached browser is reachable");
    },
    canPromptForManagedBrowserConfirmation: () => false,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(reachableCalls, 1);
  assert.equal(openAttachedCalls, 1);
  assert.equal(openDefaultCalls, 0);
  assert.equal(waitCalls, 1);
  assert.equal(waitTimeoutMs, 180_000);
  assert.match(logs.join("\n"), /Opened DoorDash in the attachable browser session I'm watching/);
  assert.match(logs.join("\n"), /Detected 1 attachable browser session/);
  assert.match(result.message, /saved it for direct API use/);
});

test("bootstrapAuthSessionWithDeps falls back to a managed browser login window and auto-completes when it can prove login", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let managedCalls = 0;
  let attachedWaitCalls = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => ["http://127.0.0.1:9222"],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => true,
    waitForAttachedBrowserSessionImport: async () => {
      attachedWaitCalls += 1;
      return false;
    },
    waitForManagedBrowserLogin: async () => {
      managedCalls += 1;
      return {
        status: "completed",
        completion: "automatic",
        auth,
      };
    },
    canPromptForManagedBrowserConfirmation: () => true,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(managedCalls, 1);
  assert.equal(attachedWaitCalls, 0);
  assert.match(logs.join("\n"), /temporary Chromium login window/);
  assert.match(logs.join("\n"), /press Enter here to force an immediate recheck/i);
  assert.match(result.message, /detected the signed-in session there automatically/i);
  assert.equal(result.success, true);
  assert.equal(result.isLoggedIn, true);
});

test("bootstrapAuthSessionWithDeps logs why an already-open desktop browser still is not reusable", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => [],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () =>
      "I can see Brave is already running on this desktop, but it is not exposing an attachable browser automation session right now.",
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => true,
    waitForAttachedBrowserSessionImport: async () => false,
    waitForManagedBrowserLogin: async () => ({
      status: "completed",
      completion: "automatic",
      auth,
    }),
    canPromptForManagedBrowserConfirmation: () => true,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.match(logs.join("\n"), /Brave is already running on this desktop/i);
  assert.match(logs.join("\n"), /couldn't find an attachable browser session I can reuse/i);
  assert.equal(result.success, true);
  assert.equal(result.isLoggedIn, true);
});

test("bootstrapAuthSessionWithDeps restores an explicit Enter-style completion path for the managed browser fallback", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => [],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => true,
    waitForAttachedBrowserSessionImport: async () => false,
    waitForManagedBrowserLogin: async () => ({
      status: "completed",
      completion: "manual",
      auth,
    }),
    canPromptForManagedBrowserConfirmation: () => true,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.match(logs.join("\n"), /press Enter here to force an immediate recheck/i);
  assert.match(result.message, /After you pressed Enter to confirm the browser login was complete/i);
  assert.equal(result.success, true);
  assert.equal(result.isLoggedIn, true);
});

test("bootstrapAuthSessionWithDeps returns a bounded failure instead of a dead-end when managed browser auto-detection cannot prove login", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: false,
    email: null,
    firstName: null,
    lastName: null,
    consumerId: null,
    marketId: null,
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let attachedWaitCalls = 0;
  let attachedWaitTimeoutMs = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => ["http://127.0.0.1:9222"],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => true,
    waitForAttachedBrowserSessionImport: async (input) => {
      attachedWaitCalls += 1;
      attachedWaitTimeoutMs = input.timeoutMs;
      return false;
    },
    waitForManagedBrowserLogin: async () => ({
      status: "timed-out",
      auth,
    }),
    canPromptForManagedBrowserConfirmation: () => true,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(attachedWaitCalls, 0);
  assert.equal(attachedWaitTimeoutMs, 0);
  assert.match(logs.join("\n"), /temporary Chromium login window/i);
  assert.match(logs.join("\n"), /press Enter here to force an immediate recheck/i);
  assert.equal(result.success, false);
  assert.equal(result.isLoggedIn, false);
  assert.match(result.message, /couldn't prove an authenticated DoorDash session/i);
  assert.match(result.message, /press Enter sooner next time/i);
});

test("bootstrapAuthSessionWithDeps falls back to quick troubleshooting guidance when the managed browser login window cannot launch", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: false,
    email: null,
    firstName: null,
    lastName: null,
    consumerId: null,
    marketId: null,
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let attachedWaitCalls = 0;
  let attachedWaitTimeoutMs = 0;
  const logs: string[] = [];
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {},
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => false,
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => ["http://127.0.0.1:9222"],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => true,
    waitForAttachedBrowserSessionImport: async (input) => {
      attachedWaitCalls += 1;
      attachedWaitTimeoutMs = input.timeoutMs;
      return false;
    },
    waitForManagedBrowserLogin: async () => ({ status: "launch-failed" }),
    canPromptForManagedBrowserConfirmation: () => true,
    checkAuthDirect: async () => auth,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(attachedWaitCalls, 1);
  assert.equal(attachedWaitTimeoutMs, 10_000);
  assert.match(logs.join("\n"), /couldn't launch the temporary Chromium login window/i);
  assert.match(logs.join("\n"), /won't keep you waiting for the full login timeout/i);
  assert.equal(result.success, false);
  assert.equal(result.isLoggedIn, false);
  assert.match(result.message, /still isn't exposing an attachable browser session/);
});

test("bootstrapAuthSessionWithDeps clears the logout block before an explicit login reuses an attached browser session", async () => {
  const auth: AuthResult = {
    success: true,
    isLoggedIn: true,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    consumerId: "consumer-1",
    marketId: "market-1",
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };

  let blocked = true;
  let clearCalls = 0;
  let importCalls = 0;
  const result = await bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport: async () => {
      clearCalls += 1;
      blocked = false;
    },
    checkPersistedAuth: async () => null,
    importBrowserSessionIfAvailable: async () => {
      importCalls += 1;
      return blocked === false;
    },
    markBrowserImportAttempted: () => {},
    getAttachedBrowserCdpCandidates: async () => [],
    getReachableCdpCandidates: async () => [],
    describeDesktopBrowserReuseGap: async () => null,
    openUrlInAttachedBrowser: async () => false,
    openUrlInDefaultBrowser: async () => false,
    waitForAttachedBrowserSessionImport: async () => false,
    waitForManagedBrowserLogin: async () => {
      throw new Error("should not launch a managed browser when explicit login can immediately reuse an attached browser session");
    },
    canPromptForManagedBrowserConfirmation: () => false,
    checkAuthDirect: async () => auth,
    log: () => {},
  });

  assert.equal(clearCalls, 1);
  assert.equal(importCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.isLoggedIn, true);
  assert.match(result.message, /Imported an existing signed-in browser session/);
});

test("parseOptionSelectionsJson parses structured recursive option selections", () => {
  assert.deepEqual(
    parseOptionSelectionsJson(
      '[{"groupId":"703393388","optionId":"4716032529"},{"groupId":"recommended_option_546935995","optionId":"546936011","children":[{"groupId":"780057412","optionId":"4702669757","quantity":2}]}]',
    ),
    [
      { groupId: "703393388", optionId: "4716032529" },
      {
        groupId: "recommended_option_546935995",
        optionId: "546936011",
        children: [{ groupId: "780057412", optionId: "4702669757", quantity: 2 }],
      },
    ],
  );
});

test("parseOptionSelectionsJson rejects malformed payloads", () => {
  assert.throws(() => parseOptionSelectionsJson('{"groupId":"x"}'), /must be a JSON array/);
  assert.throws(() => parseOptionSelectionsJson('[{"groupId":"703393388"}]'), /must include string groupId and optionId/);
  assert.throws(
    () => parseOptionSelectionsJson('[{"groupId":"703393388","optionId":"4716032529","quantity":0}]'),
    /Invalid option quantity/,
  );
  assert.throws(
    () => parseOptionSelectionsJson('[{"groupId":"703393388","optionId":"4716032529","children":{}}]'),
    /children must be an array/,
  );
});

test("resolveAvailableAddressMatch prefers a saved address id from autocomplete/get-or-create", () => {
  const match = resolveAvailableAddressMatch({
    input: "350 5th Ave, New York, NY 10118",
    availableAddresses: [
      {
        id: "5266870966",
        addressId: "1387447699",
        printableAddress: "350 5th Ave, New York, NY 10118, USA",
        shortname: "350 5th Ave",
      },
    ],
    prediction: {
      geo_address_id: "1387447699",
      formatted_address: "350 5th Ave, New York, NY 10118, USA",
    },
    createdAddress: {
      id: "1387447699",
      formatted_address: "350 5th Ave, New York, NY 10118, USA",
    },
  });

  assert.deepEqual(match, {
    id: "5266870966",
    printableAddress: "350 5th Ave, New York, NY 10118, USA",
    source: "autocomplete-address-id",
  });
});

test("resolveAvailableAddressMatch falls back to printable/shortname text matching", () => {
  const match = resolveAvailableAddressMatch({
    input: "350 5th Ave, New York, NY 10118",
    availableAddresses: [
      {
        id: "5266870966",
        addressId: "1387447699",
        printableAddress: "350 5th Ave, New York, NY 10118, USA",
        shortname: "350 5th Ave",
      },
    ],
  });

  assert.deepEqual(match, {
    id: "5266870966",
    printableAddress: "350 5th Ave, New York, NY 10118, USA",
    source: "saved-address",
  });
});

test("buildAddConsumerAddressPayload maps autocomplete/get-or-create data into addConsumerAddressV2 variables", () => {
  const payload = buildAddConsumerAddressPayload({
    requestedAddress: "11 Wall St, New York, NY 10005",
    prediction: {
      source_place_id: "ChIJ8fw4t0hawokRk1YdVjndM9w",
      formatted_address: "11 Wall St, New York, NY 10005, USA",
      formatted_address_short: "11 Wall St",
      locality: "New York",
      administrative_area_level1: "NY",
      postal_code: "10005",
      lat: 40.707757,
      lng: -74.010045,
    },
    createdAddress: {
      id: "1386875882",
      formatted_address: "11 Wall St, New York, NY 10005, USA",
      formatted_address_short: "11 Wall St",
      locality: "New York",
      administrative_area_level1: "NY",
      postal_code: "10005",
      lat: 40.707757,
      lng: -74.010045,
    },
  });

  assert.deepEqual(payload, {
    lat: 40.707757,
    lng: -74.010045,
    city: "New York",
    state: "NY",
    zipCode: "10005",
    printableAddress: "11 Wall St, New York, NY 10005, USA",
    shortname: "11 Wall St",
    googlePlaceId: "ChIJ8fw4t0hawokRk1YdVjndM9w",
    subpremise: null,
    driverInstructions: null,
    dropoffOptionId: null,
    manualLat: null,
    manualLng: null,
    addressLinkType: "ADDRESS_LINK_TYPE_UNSPECIFIED",
    buildingName: null,
    entryCode: null,
    personalAddressLabel: null,
  });
});

test("parseExistingOrderLifecycleStatus derives active, fulfilled, and cancelled states", () => {
  assert.equal(parseExistingOrderLifecycleStatus({ createdAt: "2026-03-01T12:00:00Z" }), "draft");
  assert.equal(
    parseExistingOrderLifecycleStatus({ createdAt: "2026-03-01T12:00:00Z", submittedAt: "2026-03-01T12:01:00Z" }),
    "submitted",
  );
  assert.equal(parseExistingOrderLifecycleStatus({ pollingInterval: 30, submittedAt: "2026-03-01T12:01:00Z" }), "in-progress");
  assert.equal(parseExistingOrderLifecycleStatus({ fulfilledAt: "2026-03-01T12:45:00Z" }), "fulfilled");
  assert.equal(parseExistingOrderLifecycleStatus({ cancelledAt: "2026-03-01T12:10:00Z" }), "cancelled");
});

test("parseExistingOrdersResponse normalizes DoorDash order history payloads", () => {
  const orders = parseExistingOrdersResponse([
    {
      id: "order-row-2",
      orderUuid: "order-uuid-2",
      deliveryUuid: "delivery-uuid-2",
      createdAt: "2026-03-02T12:00:00Z",
      fulfilledAt: "2026-03-02T12:50:00Z",
      pollingInterval: null,
      isReorderable: true,
      isGift: false,
      isPickup: false,
      isRetail: false,
      isMerchantShipping: false,
      containsAlcohol: false,
      fulfillmentType: "DELIVERY",
      shoppingProtocol: "STANDARD",
      orderFilterType: "PAST",
      store: {
        id: "store-2",
        name: "Sushi Place",
        business: { name: "Sushi Place" },
      },
      grandTotal: {
        unitAmount: 2599,
        currency: "USD",
        decimalPlaces: 2,
        displayString: "$25.99",
        sign: null,
      },
      orders: [
        {
          id: "sub-order-2",
          items: [
            {
              id: "line-2",
              name: "Salmon Roll",
              quantity: 2,
              specialInstructions: "extra ginger",
              substitutionPreferences: "substitute",
              originalItemPrice: 1299,
              purchaseType: "PURCHASE_TYPE_UNIT",
              purchaseQuantity: {
                discreteQuantity: { quantity: 2, unit: "ea" },
              },
              fulfillQuantity: {
                discreteQuantity: { quantity: 2, unit: "ea" },
              },
              orderItemExtras: [
                {
                  menuItemExtraId: "extra-1",
                  name: "Sauces",
                  orderItemExtraOptions: [
                    {
                      menuExtraOptionId: "option-1",
                      name: "Soy Sauce",
                      description: "low sodium",
                      price: 0,
                      quantity: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "order-row-1",
      orderUuid: "order-uuid-1",
      deliveryUuid: "delivery-uuid-1",
      createdAt: "2026-03-03T12:00:00Z",
      submittedAt: "2026-03-03T12:01:00Z",
      pollingInterval: 30,
      isReorderable: false,
      isGift: false,
      isPickup: false,
      isRetail: false,
      isMerchantShipping: false,
      containsAlcohol: false,
      fulfillmentType: "DELIVERY",
      shoppingProtocol: "STANDARD",
      orderFilterType: "ACTIVE",
      store: {
        id: "store-1",
        name: "Burger Spot",
        business: { name: "Burger Spot" },
      },
      orders: [{ id: "sub-order-1", items: [{ id: "line-1", name: "Burger", quantity: 1 }] }],
    },
  ]);

  assert.equal(orders[0]?.orderUuid, "order-uuid-1");
  assert.equal(orders[0]?.lifecycleStatus, "in-progress");
  assert.equal(orders[0]?.isActive, true);
  assert.equal(orders[1]?.grandTotal?.displayString, "$25.99");
  assert.equal(orders[1]?.items[0]?.extras[0]?.options[0]?.name, "Soy Sauce");
});

test("extractExistingOrdersFromApolloCache resolves Apollo refs from the orders page cache", () => {
  const orders = extractExistingOrdersFromApolloCache({
    ROOT_QUERY: {
      'getConsumerOrdersWithDetails({"includeCancelled":true,"limit":10,"offset":0})': [{ __ref: "ConsumerOrder:1" }],
    },
    'ConsumerOrder:1': {
      id: "row-1",
      orderUuid: "order-uuid-1",
      deliveryUuid: "delivery-uuid-1",
      createdAt: "2026-03-04T12:00:00Z",
      submittedAt: "2026-03-04T12:01:00Z",
      pollingInterval: 20,
      isReorderable: false,
      isGift: false,
      isPickup: false,
      isRetail: false,
      isMerchantShipping: false,
      containsAlcohol: false,
      fulfillmentType: "DELIVERY",
      shoppingProtocol: "STANDARD",
      orderFilterType: "ACTIVE",
      store: { __ref: "Store:1" },
      orders: [{ __ref: "GroupedOrder:1" }],
      grandTotal: { displayString: "$19.99", unitAmount: 1999, currency: "USD", decimalPlaces: 2, sign: null },
      likelyOosItems: [],
    },
    'Store:1': {
      id: "store-1",
      name: "Burger Spot",
      business: { name: "Burger Spot" },
    },
    'GroupedOrder:1': {
      id: "group-1",
      items: [{ __ref: "OrderItem:1" }],
    },
    'OrderItem:1': {
      id: "line-1",
      name: "Burger",
      quantity: 1,
    },
  });

  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.store?.name, "Burger Spot");
  assert.equal(orders[0]?.items[0]?.name, "Burger");
  assert.equal(orders[0]?.hasLiveTracking, true);
});

test("buildAddToCartPayload blocks required-option items when no selections are provided", async () => {
  await assert.rejects(
    () =>
      buildAddToCartPayload({
        restaurantId: "1721744",
        cartId: "",
        quantity: 1,
        specialInstructions: null,
        optionSelections: [],
        item: {
          id: "546936015",
          name: "Two roll selection",
          description: "Spicy tuna, salmon avo",
          displayPrice: "$18.98",
          imageUrl: null,
          nextCursor: null,
          storeId: "1721744",
        },
        itemDetail: configurableItemDetail(),
      }),
    /required option groups/,
  );
});

test("buildAddToCartPayload preserves the captured DoorDash request shape for quick-add items", async () => {
  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 2,
    specialInstructions: "extra napkins",
    optionSelections: [],
    item: {
      id: "876658890",
      name: " Sushi premium",
      description: "10pc sushi & NegiToro roll.",
      displayPrice: "$49.00",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: {
      success: true,
      restaurantId: "1721744",
      item: {
        id: "876658890",
        name: " Sushi premium",
        description: "10pc sushi & NegiToro roll.",
        displayPrice: "+$49.00",
        unitAmount: 4900,
        currency: "USD",
        decimalPlaces: 2,
        menuId: "2181443",
        specialInstructionsMaxLength: 500,
        dietaryTags: [],
        reviewData: null,
        requiredOptionLists: [],
        optionLists: [],
        preferences: [],
      },
    },
  });

  assert.deepEqual(payload, {
    addCartItemInput: {
      storeId: "1721744",
      menuId: "2181443",
      itemId: "876658890",
      itemName: " Sushi premium",
      itemDescription: "10pc sushi & NegiToro roll.",
      currency: "USD",
      quantity: 2,
      nestedOptions: "[]",
      specialInstructions: "extra napkins",
      substitutionPreference: "substitute",
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      unitPrice: 4900,
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    },
    lowPriorityBatchAddCartItemInput: [],
    fulfillmentContext: {
      shouldUpdateFulfillment: false,
      fulfillmentType: "Delivery",
    },
    monitoringContext: {
      isGroup: false,
    },
    cartContext: {
      isBundle: false,
    },
    returnCartFromOrderService: false,
    shouldKeepOnlyOneActiveCart: false,
  });
});

test("buildAddToCartPayload builds validated nestedOptions for configurable items", async () => {
  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 1,
    specialInstructions: null,
    optionSelections: [
      { groupId: "703393388", optionId: "4716032529" },
      { groupId: "703393389", optionId: "4716042466" },
    ],
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "$18.98",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: configurableItemDetail(),
  });

  assert.deepEqual(JSON.parse(payload.addCartItemInput.nestedOptions), [
    {
      id: "4716032529",
      quantity: 1,
      options: [],
      itemExtraOption: {
        id: "4716032529",
        name: "California Roll",
        description: "California Roll",
        price: 0,
        itemExtraName: null,
        chargeAbove: 0,
        defaultQuantity: 0,
        itemExtraId: "703393388",
        itemExtraNumFreeOptions: 0,
        menuItemExtraOptionPrice: 0,
        menuItemExtraOptionBasePrice: null,
      },
    },
    {
      id: "4716042466",
      quantity: 1,
      options: [],
      itemExtraOption: {
        id: "4716042466",
        name: "California Roll",
        description: "California Roll",
        price: 0,
        itemExtraName: null,
        chargeAbove: 0,
        defaultQuantity: 0,
        itemExtraId: "703393389",
        itemExtraNumFreeOptions: 0,
        menuItemExtraOptionPrice: 0,
        menuItemExtraOptionBasePrice: null,
      },
    },
  ]);
});

test("buildAddToCartPayload routes standalone recommended next-cursor items into lowPriorityBatchAddCartItemInput", async () => {
  const detail = configurableItemDetail();
  detail.item.optionLists.push({
    id: "recommended_option_546935995",
    name: "Recommended Beverages",
    subtitle: null,
    minNumOptions: 0,
    maxNumOptions: 10,
    numFreeOptions: 0,
    isOptional: true,
    options: [
      {
        id: "546936011",
        name: "Sake (salmon)",
        displayPrice: "+$5.00",
        unitAmount: 500,
        defaultQuantity: 0,
        nextCursor: "opaque-next-cursor",
      },
    ],
  });

  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 1,
    specialInstructions: null,
    optionSelections: [
      { groupId: "703393388", optionId: "4716032529" },
      { groupId: "703393389", optionId: "4716042466" },
      {
        groupId: "recommended_option_546935995",
        optionId: "546936011",
        children: [{ groupId: "780057412", optionId: "4702669757" }],
      },
    ],
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "$18.98",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: detail,
    resolveNestedOptionLists: async () => [
      {
        id: "780057412",
        name: "Choice",
        subtitle: "Select 1",
        minNumOptions: 1,
        maxNumOptions: 1,
        numFreeOptions: 0,
        isOptional: false,
        options: [
          {
            id: "4702669757",
            name: "sashimi",
            displayPrice: "",
            unitAmount: 0,
            defaultQuantity: 0,
            nextCursor: null,
          },
        ],
      },
    ],
  });

  assert.deepEqual(payload.lowPriorityBatchAddCartItemInput, [
    {
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
      storeId: "1721744",
      menuId: "2181443",
      itemId: "546936011",
      itemName: "Sake (salmon)",
      currency: "USD",
      quantity: 1,
      unitPrice: 500,
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      nestedOptions: JSON.stringify([
        {
          id: "4702669757",
          quantity: 1,
          options: [],
          itemExtraOption: {
            id: "4702669757",
            name: "sashimi",
            description: "sashimi",
            price: 0,
            chargeAbove: 0,
            defaultQuantity: 0,
          },
        },
      ]),
    },
  ]);
});

test("buildAddToCartPayload still fails closed for non-recommended next-cursor groups", async () => {
  const detail = configurableItemDetail();
  const nestedOption = detail.item.optionLists[1]?.options[0];
  assert.ok(nestedOption);
  nestedOption.nextCursor = "opaque-next-cursor";

  await assert.rejects(
    () =>
      buildAddToCartPayload({
        restaurantId: "1721744",
        cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
        quantity: 1,
        specialInstructions: null,
        optionSelections: [
          { groupId: "703393388", optionId: "4716032529" },
          { groupId: "703393389", optionId: "4716042466" },
        ],
        item: {
          id: "546936015",
          name: "Two roll selection",
          description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
          displayPrice: "$18.98",
          imageUrl: null,
          nextCursor: null,
          storeId: "1721744",
        },
        itemDetail: detail,
        resolveNestedOptionLists: async () => [],
      }),
    /safe direct cart shape is only confirmed for standalone recommended add-on groups/,
  );
});

test("buildUpdateCartPayload preserves the captured DoorDash request shape", () => {
  const payload = buildUpdateCartPayload({
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    cartItemId: "3b231d03-5a72-4636-8d12-c8769d706d45",
    itemId: "876658890",
    quantity: 1,
    storeId: "1721744",
  });

  assert.deepEqual(payload, {
    updateCartItemApiParams: {
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
      cartItemId: "3b231d03-5a72-4636-8d12-c8769d706d45",
      itemId: "876658890",
      quantity: 1,
      storeId: "1721744",
      purchaseTypeOptions: {
        purchaseType: "PURCHASE_TYPE_UNSPECIFIED",
        continuousQuantity: 0,
        unit: null,
      },
      cartFilter: null,
    },
    fulfillmentContext: {
      shouldUpdateFulfillment: false,
    },
    returnCartFromOrderService: false,
  });
});
