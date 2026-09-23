import { JwordError, type ErrorCode, type JwordErrorDetails } from "../domain/errors";

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const CODE_MAP: Record<string, ErrorCode> = {
  JW401: "UNAUTHENTICATED",
  JW403: "FORBIDDEN",
  JW404: "NOT_FOUND",
  JW409: "CONFLICT",
  JW422: "VALIDATION_ERROR",
  JW42I: "IMPORT_ROW_ERROR",
  "42501": "FORBIDDEN",
  PGRST301: "UNAUTHENTICATED",
  PGRST302: "UNAUTHENTICATED",
  PGRST303: "UNAUTHENTICATED",
};

/**
 * Translate a database/PostgREST error into a typed JwordError.
 * Messages from the jword functions are owner-safe by construction; anything else is hidden.
 */
export function mapDatabaseError(
  error: PostgrestLikeError,
  operation: string,
  mutation = false,
): JwordError {
  const code = error.code ?? "";
  const mapped = CODE_MAP[code];
  if (mapped && code.startsWith("JW")) {
    const details: JwordErrorDetails = {};
    if (error.hint) details.reason = error.hint;
    if (error.details) {
      try {
        const parsed = JSON.parse(error.details) as Record<string, unknown>;
        if (Array.isArray(parsed.candidates))
          details.candidates = parsed.candidates as JwordErrorDetails["candidates"];
        if (typeof parsed.rowIndex === "number") details.rowIndex = parsed.rowIndex;
        if (typeof parsed.currentVersion === "number")
          details.currentVersion = parsed.currentVersion;
        if (typeof parsed.expectedVersion === "number")
          details.expectedVersion = parsed.expectedVersion;
        if (typeof parsed.watchId === "string") details.watchId = parsed.watchId;
        if (typeof parsed.watchActive === "boolean") details.watchActive = parsed.watchActive;
        if (typeof parsed.company === "string") details.company = parsed.company;
      } catch {
        // detail was not JSON; ignore
      }
    }
    return new JwordError(mapped, error.message ?? "Request failed.", details);
  }
  if (mapped === "FORBIDDEN") {
    return new JwordError("FORBIDDEN", "You do not have permission to do that.");
  }
  if (mapped === "UNAUTHENTICATED") {
    return new JwordError("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }
  // Preserve only the error code for diagnostics; raw messages can contain row data.
  console.error(
    JSON.stringify({
      operation,
      databaseCode: /^[A-Z0-9]{1,12}$/.test(code) ? code : "TRANSPORT_ERROR",
    }),
  );
  if (!mutation)
    return new JwordError("INTERNAL_ERROR", `${operation} could not be loaded. Try again.`);
  // A SQL error confirms rollback. Transport/gateway failures do not prove that a
  // mutation failed: its response may have been lost after commit.
  if (/^[0-9A-Z]{5}$/.test(code)) {
    return new JwordError(
      "INTERNAL_ERROR",
      `${operation} failed. The database rejected the request.`,
    );
  }
  return new JwordError(
    "OUTCOME_UNKNOWN",
    `${operation}: the result is unconfirmed. Retry the identical command with the same request ID.`,
  );
}
