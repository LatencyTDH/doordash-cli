import { readFileSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright";
import {
  resolveAttachedBrowserCdpCandidates,
  inspectLocalBrowserProfileImportCandidates,
  inspectPersistedAuthDirect,
  type AttachedBrowserCdpInspection,
  type AuthResult,
  type LocalBrowserProfileImportInspection,
} from "./direct-api.js";
import { getBrowserImportBlockPath, getCookiesPath, getStorageStatePath } from "./session-storage.js";

const PACKAGE_JSON_PATH = new URL("../package.json", import.meta.url);
const PACKAGE_VERSION = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).version as string;

export type DoctorStatus = "ok" | "warn" | "error" | "info" | "unknown";

export type DoctorFileCheck = {
  displayPath: string;
  exists: boolean;
  sizeBytes: number | null;
};

export type DoctorRecommendation = {
  priority: number;
  title: string;
  details: string;
  command: string | null;
};

export type DoctorSectionSummary = {
  status: DoctorStatus;
  detail: string;
};

export type DoctorResult = {
  success: true;
  schemaVersion: 1;
  command: "doctor";
  generatedAt: string;
  summary: {
    status: Exclude<DoctorStatus, "info" | "unknown"> | "ok";
    headline: string;
    warningCount: number;
    errorCount: number;
    infoCount: number;
  };
  runtime: {
    cliVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  playwrightChromium: DoctorSectionSummary & {
    installed: boolean;
    executablePath: string | null;
  };
  savedSessionArtifacts: DoctorSectionSummary & {
    cookies: DoctorFileCheck;
    storageState: DoctorFileCheck;
  };
  savedAuth: DoctorSectionSummary & {
    appearsLoggedIn: boolean | null;
  };
  passiveBrowserImport: DoctorSectionSummary & {
    blocked: boolean;
    blockPath: string;
  };
  sameMachineProfileImport: DoctorSectionSummary & {
    supported: boolean;
    candidates: Array<{
      browserLabel: string;
      userDataDir: string;
      userDataDirExists: boolean;
      importableProfileNames: string[];
      importableProfileCount: number;
    }>;
  };
  attachedBrowserCdp: DoctorSectionSummary & {
    candidateCount: number;
    reachableCount: number;
    discoveredCandidates: string[];
    reachableCandidates: string[];
    reuseGap: string | null;
  };
  recommendations: DoctorRecommendation[];
};

type DoctorDeps = {
  now: () => Date;
  runtime: {
    cliVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  paths: {
    homeDir: string;
    cookiesPath: string;
    storageStatePath: string;
    browserImportBlockPath: string;
  };
  inspectFile: (path: string) => Promise<DoctorFileCheck>;
  inspectChromium: () => Promise<{ installed: boolean; executablePath: string | null }>;
  inspectSavedAuth: () => Promise<AuthResult | null>;
  inspectLocalBrowserProfiles: () => Promise<LocalBrowserProfileImportInspection>;
  inspectAttachedBrowser: () => Promise<AttachedBrowserCdpInspection>;
};

export async function runDoctor(): Promise<DoctorResult> {
  return runDoctorWithDeps(createDefaultDoctorDeps());
}

export async function runDoctorWithDeps(deps: DoctorDeps): Promise<DoctorResult> {
  const [cookies, storageState, browserImportBlock] = await Promise.all([
    deps.inspectFile(deps.paths.cookiesPath),
    deps.inspectFile(deps.paths.storageStatePath),
    deps.inspectFile(deps.paths.browserImportBlockPath),
  ]);
  const [playwrightChromiumRaw, savedAuthRaw, sameMachineRaw, attachedRaw] = await Promise.all([
    deps.inspectChromium(),
    deps.inspectSavedAuth().catch(() => null),
    deps.inspectLocalBrowserProfiles(),
    deps.inspectAttachedBrowser(),
  ]);

  const artifactsExistCount = [cookies.exists, storageState.exists].filter(Boolean).length;
  const savedSessionArtifacts: DoctorResult["savedSessionArtifacts"] =
    artifactsExistCount === 2
      ? {
          status: "ok",
          detail: "Saved session artifacts are present.",
          cookies,
          storageState,
        }
      : artifactsExistCount === 1
        ? {
            status: "warn",
            detail: "Saved session artifacts are incomplete. Re-login is recommended before relying on saved auth.",
            cookies,
            storageState,
          }
        : {
            status: "warn",
            detail: "No saved session artifacts were found.",
            cookies,
            storageState,
          };

  const savedAuth: DoctorResult["savedAuth"] =
    artifactsExistCount === 0
      ? {
          status: "warn",
          detail: "No saved session artifacts were available to validate.",
          appearsLoggedIn: null,
        }
      : savedAuthRaw === null
        ? {
            status: "unknown",
            detail: "Saved session artifacts exist, but this environment could not validate them right now.",
            appearsLoggedIn: null,
          }
        : savedAuthRaw.isLoggedIn
          ? {
              status: "ok",
              detail: "Saved auth appears valid for direct API use.",
              appearsLoggedIn: true,
            }
          : {
              status: "warn",
              detail: "Saved session artifacts exist, but DoorDash currently reports a logged-out or guest session.",
              appearsLoggedIn: false,
            };

  const passiveBrowserImport: DoctorResult["passiveBrowserImport"] = browserImportBlock.exists
    ? {
        status: "warn",
        detail: "Passive browser-session import is currently blocked because `logout` wrote a local block marker.",
        blocked: true,
        blockPath: browserImportBlock.displayPath,
      }
    : {
        status: "ok",
        detail: "Passive browser-session import is not blocked.",
        blocked: false,
        blockPath: browserImportBlock.displayPath,
      };

  const sameMachineImportableCount = sameMachineRaw.candidates.reduce((total: number, candidate: any) => total + candidate.importableProfileCount, 0);
  const sameMachineExistingRoots = sameMachineRaw.candidates.filter((candidate: any) => candidate.userDataDirExists).length;
  const sameMachineProfileImport: DoctorResult["sameMachineProfileImport"] = !sameMachineRaw.supported
    ? {
        status: "info",
        detail: "Same-machine browser profile import is not supported on this platform. Linux, macOS, and Windows are supported today.",
        supported: false,
        candidates: sameMachineRaw.candidates.map((candidate: any) => ({
          ...candidate,
          userDataDir: redactPath(candidate.userDataDir, deps.paths.homeDir),
        })),
      }
    : sameMachineImportableCount > 0
      ? {
          status: "ok",
          detail: `Found ${sameMachineImportableCount} importable same-machine browser profile${sameMachineImportableCount === 1 ? "" : "s"}.`,
          supported: true,
          candidates: sameMachineRaw.candidates.map((candidate: any) => ({
            ...candidate,
            userDataDir: redactPath(candidate.userDataDir, deps.paths.homeDir),
          })),
        }
      : sameMachineExistingRoots > 0
        ? {
            status: "info",
            detail: "Known local Brave/Chrome profile roots exist, but no importable DoorDash profile state was detected right now.",
            supported: true,
            candidates: sameMachineRaw.candidates.map((candidate: any) => ({
              ...candidate,
              userDataDir: redactPath(candidate.userDataDir, deps.paths.homeDir),
            })),
          }
        : {
            status: "info",
            detail: "No known same-machine Brave/Chrome profile roots were detected for this platform.",
            supported: true,
            candidates: sameMachineRaw.candidates.map((candidate: any) => ({
              ...candidate,
              userDataDir: redactPath(candidate.userDataDir, deps.paths.homeDir),
            })),
          };

  const attachedBrowserCdp: DoctorResult["attachedBrowserCdp"] = attachedRaw.reachableCandidates.length > 0
    ? {
        status: "ok",
        detail: `Found ${attachedRaw.reachableCandidates.length} reachable attachable browser/CDP candidate${attachedRaw.reachableCandidates.length === 1 ? "" : "s"}.`,
        candidateCount: attachedRaw.discoveredCandidates.length,
        reachableCount: attachedRaw.reachableCandidates.length,
        discoveredCandidates: attachedRaw.discoveredCandidates.map(sanitizeCdpCandidate),
        reachableCandidates: attachedRaw.reachableCandidates.map(sanitizeCdpCandidate),
        reuseGap: attachedRaw.reuseGap,
      }
    : attachedRaw.discoveredCandidates.length > 0
      ? {
          status: "info",
          detail: `Discovered ${attachedRaw.discoveredCandidates.length} attachable browser/CDP candidate${attachedRaw.discoveredCandidates.length === 1 ? "" : "s"}, but none were reachable right now.`,
          candidateCount: attachedRaw.discoveredCandidates.length,
          reachableCount: 0,
          discoveredCandidates: attachedRaw.discoveredCandidates.map(sanitizeCdpCandidate),
          reachableCandidates: [],
          reuseGap: attachedRaw.reuseGap,
        }
      : {
          status: "info",
          detail: attachedRaw.reuseGap ?? "No attachable browser/CDP candidates were discovered from env, config, or default localhost ports.",
          candidateCount: 0,
          reachableCount: 0,
          discoveredCandidates: [],
          reachableCandidates: [],
          reuseGap: attachedRaw.reuseGap,
        };

  const playwrightChromium: DoctorResult["playwrightChromium"] = playwrightChromiumRaw.installed
    ? {
        status: "ok",
        detail: "Playwright Chromium is installed.",
        installed: true,
        executablePath: playwrightChromiumRaw.executablePath ? redactPath(playwrightChromiumRaw.executablePath, deps.paths.homeDir) : null,
      }
    : {
        status: "warn",
        detail: "Playwright Chromium is not installed. The managed browser login fallback will not work until it is installed.",
        installed: false,
        executablePath: playwrightChromiumRaw.executablePath ? redactPath(playwrightChromiumRaw.executablePath, deps.paths.homeDir) : null,
      };

  const sections: DoctorStatus[] = [
    playwrightChromium.status,
    savedSessionArtifacts.status,
    savedAuth.status,
    passiveBrowserImport.status,
    sameMachineProfileImport.status,
    attachedBrowserCdp.status,
  ];
  const warningCount = sections.filter((status) => status === "warn").length;
  const errorCount = sections.filter((status) => status === "error").length;
  const infoCount = sections.filter((status) => status === "info" || status === "unknown").length;
  const summaryStatus: DoctorResult["summary"]["status"] = errorCount > 0 ? "error" : warningCount > 0 ? "warn" : "ok";
  const summaryHeadline =
    summaryStatus === "ok"
      ? "All primary diagnostics look healthy."
      : errorCount > 0
        ? `${errorCount} error(s) and ${warningCount} warning(s) detected.`
        : `${warningCount} actionable warning(s) detected.`;

  const recommendations = buildRecommendations({
    playwrightChromium,
    savedSessionArtifacts,
    savedAuth,
    passiveBrowserImport,
    sameMachineProfileImport,
    attachedBrowserCdp,
    summaryStatus,
  });

  return {
    success: true,
    schemaVersion: 1,
    command: "doctor",
    generatedAt: deps.now().toISOString(),
    summary: {
      status: summaryStatus,
      headline: summaryHeadline,
      warningCount,
      errorCount,
      infoCount,
    },
    runtime: {
      ...deps.runtime,
    },
    playwrightChromium,
    savedSessionArtifacts,
    savedAuth,
    passiveBrowserImport,
    sameMachineProfileImport,
    attachedBrowserCdp,
    recommendations,
  };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines = [
    `doordash-cli doctor v${result.runtime.cliVersion}`,
    `Overall: ${formatStatusLabel(result.summary.status)} — ${result.summary.headline}`,
    "",
    "Runtime",
    `- CLI version: ${result.runtime.cliVersion}`,
    `- Node.js: ${result.runtime.nodeVersion}`,
    `- Platform: ${result.runtime.platform} ${result.runtime.arch}`,
    "",
    "Checks",
    `- [${formatStatusLabel(result.playwrightChromium.status)}] Playwright Chromium: ${result.playwrightChromium.detail}`,
    ...(result.playwrightChromium.executablePath ? [`  - Executable: ${result.playwrightChromium.executablePath}`] : []),
    `- [${formatStatusLabel(result.savedSessionArtifacts.status)}] Saved session artifacts: ${result.savedSessionArtifacts.detail}`,
    `  - cookies.json: ${formatFilePresence(result.savedSessionArtifacts.cookies)}`,
    `  - storage-state.json: ${formatFilePresence(result.savedSessionArtifacts.storageState)}`,
    `- [${formatStatusLabel(result.savedAuth.status)}] Saved auth: ${result.savedAuth.detail}`,
    `- [${formatStatusLabel(result.passiveBrowserImport.status)}] Passive browser import: ${result.passiveBrowserImport.detail}`,
    `  - Block marker: ${result.passiveBrowserImport.blocked ? result.passiveBrowserImport.blockPath : "not present"}`,
    `- [${formatStatusLabel(result.sameMachineProfileImport.status)}] Same-machine browser profiles: ${result.sameMachineProfileImport.detail}`,
    ...formatSameMachineCandidateLines(result.sameMachineProfileImport.candidates),
    `- [${formatStatusLabel(result.attachedBrowserCdp.status)}] Attachable browser/CDP: ${result.attachedBrowserCdp.detail}`,
    ...formatAttachedBrowserLines(result.attachedBrowserCdp),
    "",
    "Recommended next steps",
    ...(result.recommendations.length > 0
      ? result.recommendations.map((recommendation) => `${recommendation.priority}. ${recommendation.title}${recommendation.command ? ` (${recommendation.command})` : ""}`)
      : ["1. No immediate action recommended."]),
  ];

  if (result.recommendations.length > 0) {
    lines.push("", "Details");
    for (const recommendation of result.recommendations) {
      lines.push(`${recommendation.priority}. ${recommendation.details}`);
    }
  }

  return lines.join("\n");
}

function createDefaultDoctorDeps(): DoctorDeps {
  const homeDir = homedir();
  return {
    now: () => new Date(),
    runtime: {
      cliVersion: PACKAGE_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    paths: {
      homeDir,
      cookiesPath: getCookiesPath(),
      storageStatePath: getStorageStatePath(),
      browserImportBlockPath: getBrowserImportBlockPath(),
    },
    inspectFile: async (path) => inspectFile(path, homeDir),
    inspectChromium: async () => {
      try {
        const executablePath = chromium.executablePath();
        const installed = await access(executablePath)
          .then(() => true)
          .catch(() => false);
        return {
          installed,
          executablePath,
        };
      } catch {
        return {
          installed: false,
          executablePath: null,
        };
      }
    },
    inspectSavedAuth: inspectPersistedAuthDirect,
    inspectLocalBrowserProfiles: inspectLocalBrowserProfileImportCandidates,
    inspectAttachedBrowser: async () => ({
      discoveredCandidates: resolveAttachedBrowserCdpCandidates(process.env),
      reachableCandidates: [],
      reuseGap: null,
    }),
  };
}

async function inspectFile(path: string, homeDir: string): Promise<DoctorFileCheck> {
  try {
    const entry = await stat(path);
    return {
      displayPath: redactPath(path, homeDir),
      exists: true,
      sizeBytes: entry.isFile() ? entry.size : null,
    };
  } catch {
    return {
      displayPath: redactPath(path, homeDir),
      exists: false,
      sizeBytes: null,
    };
  }
}

function buildRecommendations(input: {
  playwrightChromium: DoctorResult["playwrightChromium"];
  savedSessionArtifacts: DoctorResult["savedSessionArtifacts"];
  savedAuth: DoctorResult["savedAuth"];
  passiveBrowserImport: DoctorResult["passiveBrowserImport"];
  sameMachineProfileImport: DoctorResult["sameMachineProfileImport"];
  attachedBrowserCdp: DoctorResult["attachedBrowserCdp"];
  summaryStatus: DoctorResult["summary"]["status"];
}): DoctorRecommendation[] {
  const recommendations: DoctorRecommendation[] = [];
  let priority = 1;

  if (input.passiveBrowserImport.blocked) {
    recommendations.push({
      priority: priority++,
      title: "Run an explicit login to clear the logout block and refresh saved auth.",
      details:
        "`doordash-cli login` removes the local logout block marker, then tries saved auth, same-machine browser profile reuse, attachable browser reuse, and finally the managed Chromium fallback.",
      command: "doordash-cli login",
    });
  } else if (input.savedAuth.appearsLoggedIn !== true) {
    recommendations.push({
      priority: priority++,
      title: "Establish or refresh a saved DoorDash session.",
      details: "Run `doordash-cli login` to create a fresh saved session or replace a stale one.",
      command: "doordash-cli login",
    });
  }

  if (!input.playwrightChromium.installed) {
    recommendations.push({
      priority: priority++,
      title: "Install the bundled Playwright Chromium runtime.",
      details: "The managed browser login fallback depends on Playwright Chromium. Install it once, then rerun the doctor command.",
      command: "doordash-cli install-browser",
    });
  }

  if (
    input.savedAuth.appearsLoggedIn !== true &&
    input.sameMachineProfileImport.supported &&
    input.sameMachineProfileImport.candidates.some((candidate) => candidate.userDataDirExists) &&
    input.sameMachineProfileImport.candidates.every((candidate) => candidate.importableProfileCount === 0)
  ) {
    recommendations.push({
      priority: priority++,
      title: "If you want passive same-machine reuse, sign into DoorDash in a local Brave or Google Chrome profile on this machine.",
      details:
        "On Linux, macOS, and Windows, that is the preferred browser reuse path before CDP attach or the temporary managed-browser fallback when the local Chrome/Brave profile contains reusable DoorDash auth state.",
      command: null,
    });
  }

  if (input.savedAuth.appearsLoggedIn !== true && input.attachedBrowserCdp.reachableCount === 0) {
    recommendations.push({
      priority: priority++,
      title:
        input.attachedBrowserCdp.candidateCount > 0
          ? "Make one attachable browser/CDP candidate reachable before retrying browser reuse."
          : "If you want attachable browser reuse, expose a reachable browser/CDP endpoint before retrying.",
      details:
        input.attachedBrowserCdp.candidateCount > 0
          ? "The CLI found browser/CDP candidates but could not reach them. Verify the target browser is still running and exposing a reachable localhost CDP endpoint."
          : "The CLI did not discover any attachable browser/CDP endpoints from env, config, or default localhost ports. Starting a browser with remote debugging enabled is the usual fix.",
      command: null,
    });
  }

  if (input.summaryStatus !== "ok") {
    recommendations.push({
      priority: priority++,
      title: "Capture JSON output if you need to file an issue or automate follow-up checks.",
      details: "Run `doordash-cli doctor --json` and attach the result. The report is designed to be safe to paste and excludes auth secrets/cookies.",
      command: "doordash-cli doctor --json",
    });
  }

  return recommendations;
}

function formatStatusLabel(status: DoctorStatus | DoctorResult["summary"]["status"]): string {
  return status.toUpperCase();
}

function formatFilePresence(file: DoctorFileCheck): string {
  if (!file.exists) {
    return `missing (${file.displayPath})`;
  }

  return `${file.sizeBytes ?? 0} bytes (${file.displayPath})`;
}

function formatSameMachineCandidateLines(
  candidates: DoctorResult["sameMachineProfileImport"]["candidates"],
): string[] {
  if (candidates.length === 0) {
    return [];
  }

  return candidates.map((candidate) => {
    const importableProfiles =
      candidate.importableProfileCount > 0 ? `; importable profiles: ${candidate.importableProfileNames.join(", ")}` : "";
    return `  - ${candidate.browserLabel}: ${candidate.userDataDirExists ? "found" : "missing"} at ${candidate.userDataDir}${importableProfiles}`;
  });
}

function formatAttachedBrowserLines(section: DoctorResult["attachedBrowserCdp"]): string[] {
  const lines: string[] = [];
  if (section.discoveredCandidates.length > 0) {
    lines.push(`  - Discovered: ${section.discoveredCandidates.join(", ")}`);
  }
  if (section.reachableCandidates.length > 0) {
    lines.push(`  - Reachable: ${section.reachableCandidates.join(", ")}`);
  }
  if (section.reuseGap) {
    lines.push(`  - Context: ${section.reuseGap}`);
  }
  return lines;
}

export function redactPath(path: string, homeDir: string = homedir()): string {
  if (homeDir && path.startsWith(homeDir)) {
    return `~${path.slice(homeDir.length)}`;
  }
  return path;
}

export function sanitizeCdpCandidate(candidate: string): string {
  try {
    const url = new URL(candidate);
    const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    const hostname = isLoopback ? url.hostname : "<redacted-host>";
    return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return candidate.replace(/\/\/[^/@]+@/, "//<redacted>@").replace(/[?#].*$/, "");
  }
}
