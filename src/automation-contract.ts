export const EXIT_CODES = {
  success: 0,
  usage: 2,
  unsupported: 3,
  auth: 4,
  remote: 5,
  internal: 1,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type CliFailureKind = "usage" | "unsupported" | "blocked" | "auth" | "remote" | "internal";

export type AutomationErrorCode =
  | "usage_error"
  | "unsupported_command"
  | "blocked_command"
  | "unsupported_flag"
  | "invalid_options_json"
  | "auth_failed"
  | "remote_error"
  | "internal_error";

export type AutomationErrorDetails = Record<string, unknown>;

export class CliError extends Error {
  readonly kind: CliFailureKind;
  readonly code: AutomationErrorCode;
  readonly details?: AutomationErrorDetails;

  constructor(input: {
    kind: CliFailureKind;
    code: AutomationErrorCode;
    message: string;
    details?: AutomationErrorDetails;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "CliError";
    this.kind = input.kind;
    this.code = input.code;
    this.details = input.details;
  }

  static usage(code: Extract<AutomationErrorCode, "usage_error" | "unsupported_flag" | "invalid_options_json">, message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "usage", code, message, details, cause });
  }

  static unsupported(code: Extract<AutomationErrorCode, "unsupported_command">, message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "unsupported", code, message, details, cause });
  }

  static blocked(message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "blocked", code: "blocked_command", message, details, cause });
  }

  static auth(message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "auth", code: "auth_failed", message, details, cause });
  }

  static remote(message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "remote", code: "remote_error", message, details, cause });
  }

  static internal(message: string, details?: AutomationErrorDetails, cause?: unknown): CliError {
    return new CliError({ kind: "internal", code: "internal_error", message, details, cause });
  }
}

export type AutomationSuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta: {
    command: string | null;
    exitCode: 0;
    version: string;
  };
};

export type AutomationErrorEnvelope = {
  ok: false;
  error: {
    code: AutomationErrorCode;
    message: string;
    details?: AutomationErrorDetails;
  };
  meta: {
    command: string | null;
    exitCode: Exclude<ExitCode, 0>;
    version: string;
  };
};

export function exitCodeForCliError(error: CliError): Exclude<ExitCode, 0> {
  switch (error.kind) {
    case "usage":
      return EXIT_CODES.usage;

    case "unsupported":
    case "blocked":
      return EXIT_CODES.unsupported;

    case "auth":
      return EXIT_CODES.auth;

    case "remote":
      return EXIT_CODES.remote;

    case "internal":
      return EXIT_CODES.internal;
  }
}

export function buildAutomationSuccessEnvelope<T>(input: {
  command: string | null;
  version: string;
  data: T;
}): AutomationSuccessEnvelope<T> {
  return {
    ok: true,
    data: input.data,
    meta: {
      command: input.command,
      exitCode: 0,
      version: input.version,
    },
  };
}

export function buildAutomationErrorEnvelope(input: {
  command: string | null;
  version: string;
  error: CliError;
}): AutomationErrorEnvelope {
  return {
    ok: false,
    error: {
      code: input.error.code,
      message: input.error.message,
      ...(input.error.details ? { details: input.error.details } : {}),
    },
    meta: {
      command: input.command,
      exitCode: exitCodeForCliError(input.error),
      version: input.version,
    },
  };
}

export function parseJsonFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (["", "true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw CliError.usage("usage_error", `Invalid --json: ${value}. Expected true or false.`, {
    flag: "json",
    received: value,
  });
}

export function toCliError(error: unknown, command: string | null): CliError {
  if (error instanceof CliError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (looksLikeUsageErrorMessage(message)) {
    return CliError.usage(usageErrorCodeForMessage(message), message, { command }, error);
  }

  if (looksLikeRemoteErrorMessage(message)) {
    return CliError.remote(message, { command }, error);
  }

  return CliError.internal(message, { command }, error);
}

export function shouldPrintUsage(error: CliError): boolean {
  return error.kind === "usage" || error.kind === "unsupported" || error.kind === "blocked";
}

function looksLikeUsageErrorMessage(message: string): boolean {
  return [
    /^Missing required flag --/,
    /^Invalid --/,
    /^Unexpected positional argument:/,
    /^Unexpected empty argument$/,
    /^Empty flag name$/,
    /^Missing required flag --item-id or --item-name$/,
    /^--options-json must be a JSON array/,
    /^This item has required option groups\./,
    /^Couldn't find item /,
  ].some((pattern) => pattern.test(message));
}

function usageErrorCodeForMessage(message: string): Extract<AutomationErrorCode, "usage_error" | "invalid_options_json"> {
  if (/^--options-json must be a JSON array/.test(message)) {
    return "invalid_options_json";
  }

  return "usage_error";
}

function looksLikeRemoteErrorMessage(message: string): boolean {
  return [
    /DoorDash /i,
    /GraphQL error/i,
    /non-JSON response/i,
    /cf-mitigated/i,
    /Checking if the site connection is secured/i,
    /fetch failed/i,
    /ECONN/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /EAI_AGAIN/i,
  ].some((pattern) => pattern.test(message));
}
