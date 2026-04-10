import test from "node:test";
import assert from "node:assert/strict";
import { renderCommandOutput } from "./cli.js";
import { formatDoctorReport, redactPath, runDoctorWithDeps, sanitizeCdpCandidate } from "./doctor.js";
import type { AuthResult } from "./direct-api.js";

function baseAuthResult(isLoggedIn: boolean): AuthResult {
  return {
    success: true,
    isLoggedIn,
    email: isLoggedIn ? "user@example.com" : null,
    firstName: isLoggedIn ? "Test" : null,
    lastName: isLoggedIn ? "User" : null,
    consumerId: isLoggedIn ? "consumer-1" : null,
    marketId: isLoggedIn ? "market-1" : null,
    defaultAddress: null,
    cookiesPath: "/tmp/cookies.json",
    storageStatePath: "/tmp/storage-state.json",
  };
}

test("doctor prioritizes actionable remediations and produces a paste-safe human report", async () => {
  const result = await runDoctorWithDeps({
    now: () => new Date("2026-04-10T12:34:56.000Z"),
    runtime: {
      cliVersion: "0.4.2",
      nodeVersion: "v24.1.0",
      platform: "linux",
      arch: "x64",
    },
    paths: {
      homeDir: "/home/test",
      cookiesPath: "/home/test/.local/state/doordash-cli/cookies.json",
      storageStatePath: "/home/test/.local/state/doordash-cli/storage-state.json",
      browserImportBlockPath: "/home/test/.local/state/doordash-cli/browser-import-blocked",
    },
    inspectFile: async (path) => {
      if (path.endsWith("browser-import-blocked")) {
        return { displayPath: "~/.local/state/doordash-cli/browser-import-blocked", exists: true, sizeBytes: 11 };
      }
      return { displayPath: path.replace("/home/test", "~"), exists: false, sizeBytes: null };
    },
    inspectChromium: async () => ({
      installed: false,
      executablePath: "/home/test/.cache/ms-playwright/chromium-123/chrome",
    }),
    inspectSavedAuth: async () => baseAuthResult(false),
    inspectLocalBrowserProfiles: async () => ({
      supported: true,
      platform: "linux",
      candidates: [
        {
          browserLabel: "Brave",
          userDataDir: "/home/test/.config/BraveSoftware/Brave-Browser",
          userDataDirExists: true,
          importableProfileNames: [],
          importableProfileCount: 0,
        },
      ],
    }),
    inspectAttachedBrowser: async () => ({
      discoveredCandidates: ["http://alice:secret@example.internal:9222/json/version?token=abc"],
      reachableCandidates: [],
      reuseGap:
        "I can see Brave is already running on this desktop, but dd-cli still couldn't reuse it automatically. It is not exposing an attachable browser automation session right now, and no importable signed-in DoorDash browser profile state was found.",
    }),
  });

  assert.equal(result.summary.status, "warn");
  assert.equal(result.generatedAt, "2026-04-10T12:34:56.000Z");
  assert.equal(result.playwrightChromium.installed, false);
  assert.equal(result.passiveBrowserImport.blocked, true);
  assert.equal(result.sameMachineProfileImport.status, "info");
  assert.equal(result.attachedBrowserCdp.discoveredCandidates[0], "http://<redacted-host>:9222");
  assert.deepEqual(
    result.recommendations.map((recommendation) => recommendation.command),
    [
      "doordash-cli login",
      "doordash-cli install-browser",
      null,
      null,
      "doordash-cli doctor --json",
    ],
  );

  const text = formatDoctorReport(result);
  assert.match(text, /Overall: WARN/);
  assert.match(text, /Playwright Chromium is not installed/);
  assert.match(text, /Passive browser-session import is currently blocked/);
  assert.match(text, /doordash-cli login/);
  assert.match(text, /doordash-cli install-browser/);
  assert.match(text, /~\/\.local\/state\/doordash-cli\/cookies\.json/);
  assert.match(text, /http:\/\/<redacted-host>:9222/);
  assert.doesNotMatch(text, /alice:secret@example\.internal/);
  assert.doesNotMatch(text, /example\.internal:9222\/json\/version\?token=abc/);
});

test("doctor supports human and JSON rendering without changing JSON output for other commands", async () => {
  const result = await runDoctorWithDeps({
    now: () => new Date("2026-04-10T16:00:00.000Z"),
    runtime: {
      cliVersion: "0.4.2",
      nodeVersion: "v24.1.0",
      platform: "linux",
      arch: "arm64",
    },
    paths: {
      homeDir: "/home/test",
      cookiesPath: "/home/test/.local/state/doordash-cli/cookies.json",
      storageStatePath: "/home/test/.local/state/doordash-cli/storage-state.json",
      browserImportBlockPath: "/home/test/.local/state/doordash-cli/browser-import-blocked",
    },
    inspectFile: async (path) => ({
      displayPath: path.replace("/home/test", "~"),
      exists: !path.endsWith("browser-import-blocked"),
      sizeBytes: path.endsWith("browser-import-blocked") ? null : 128,
    }),
    inspectChromium: async () => ({
      installed: true,
      executablePath: "/home/test/.cache/ms-playwright/chromium-123/chrome",
    }),
    inspectSavedAuth: async () => baseAuthResult(true),
    inspectLocalBrowserProfiles: async () => ({
      supported: true,
      platform: "linux",
      candidates: [
        {
          browserLabel: "Google Chrome",
          userDataDir: "/home/test/.config/google-chrome",
          userDataDirExists: true,
          importableProfileNames: ["Default"],
          importableProfileCount: 1,
        },
      ],
    }),
    inspectAttachedBrowser: async () => ({
      discoveredCandidates: ["http://127.0.0.1:9222"],
      reachableCandidates: ["http://127.0.0.1:9222"],
      reuseGap: null,
    }),
  });

  assert.equal(result.summary.status, "ok");
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.playwrightChromium.status, "ok");
  assert.equal(result.savedAuth.appearsLoggedIn, true);
  assert.equal(result.sameMachineProfileImport.status, "ok");
  assert.equal(result.attachedBrowserCdp.status, "ok");

  const humanOutput = await renderCommandOutput("doctor", {}, result);
  assert.match(humanOutput, /^doordash-cli doctor v0\.4\.2/);
  assert.match(humanOutput, /Overall: OK/);
  assert.match(humanOutput, /No immediate action recommended/);
  assert.doesNotMatch(humanOutput, /^\{/);

  const jsonOutput = await renderCommandOutput("doctor", { json: "true" }, result);
  assert.deepEqual(JSON.parse(jsonOutput), result);

  const searchJson = await renderCommandOutput("search", {}, { success: true, query: "sushi" });
  assert.deepEqual(JSON.parse(searchJson), { success: true, query: "sushi" });
});

test("paste-safe helpers redact paths and non-loopback browser endpoints", () => {
  assert.equal(redactPath("/home/test/.local/state/doordash-cli/cookies.json", "/home/test"), "~/.local/state/doordash-cli/cookies.json");
  assert.equal(sanitizeCdpCandidate("http://alice:secret@example.internal:9222/json/version?token=abc"), "http://<redacted-host>:9222");
  assert.equal(sanitizeCdpCandidate("http://127.0.0.1:9222/json/version"), "http://127.0.0.1:9222");
});
