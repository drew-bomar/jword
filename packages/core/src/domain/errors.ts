export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "AMBIGUOUS_MATCH",
  "IMPORT_ROW_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ConflictReason = "STALE_VERSION" | "REQUEST_ID_REUSED" | "DUPLICATE_CANDIDATES";

export interface DuplicateCandidate {
  applicationId: string;
  company: string;
  title: string;
  status: string;
  matchedOn: string[];
}

export interface JwordErrorDetails {
  reason?: string;
  candidates?: DuplicateCandidate[];
  fieldErrors?: Record<string, string[]>;
  rowIndex?: number;
  currentVersion?: number;
  expectedVersion?: number;
}

/**
 * Typed application error shared by web, MCP, services, and repositories.
 * `message` is always safe to show to the owner; raw database text never lands here.
 */
export class JwordError extends Error {
  readonly code: ErrorCode;
  readonly details: JwordErrorDetails;

  constructor(code: ErrorCode, message: string, details: JwordErrorDetails = {}) {
    super(message);
    this.name = "JwordError";
    this.code = code;
    this.details = details;
  }

  get reason(): string | undefined {
    return this.details.reason;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export function isJwordError(error: unknown): error is JwordError {
  return error instanceof JwordError;
}

export function toJwordError(error: unknown): JwordError {
  if (isJwordError(error)) return error;
  return new JwordError("INTERNAL_ERROR", "Something went wrong. The change was not saved.");
}
