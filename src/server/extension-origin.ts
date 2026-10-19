import { JwordError, type ErrorCode } from "@jword/core/browser";

/**
 * Request checks for the capture extension API (decision 017), kept free of Next.js and
 * Supabase imports so they can be unit tested.
 *
 * The API authenticates with the owner's normal session cookie, so it must also prove the request
 * came from the jword extension. Browsers set `Origin` themselves and web pages cannot forge it:
 * a fetch from any website carries that site's origin and is rejected here. That is the defense
 * against cross-site request forgery (CSRF: another site making the owner's browser send an
 * authenticated request). Chrome only sends `Origin` on the extension's POST requests (not GET),
 * so every endpoint is POST.
 */

const EXTENSION_ID = /^[a-p]{32}$/;
export const EXTENSION_API_MAX_BYTES = 256_000;

export function extensionOrigin(extensionId: string | null): string | null {
  return extensionId && EXTENSION_ID.test(extensionId) ? `chrome-extension://${extensionId}` : null;
}

/**
 * The allowed extension ids from JWORD_EXTENSION_IDS (comma list) and the older single
 * JWORD_EXTENSION_ID (decision 027): the unpacked/zip build and the Chrome Web Store build have
 * different ids. Malformed entries are dropped, so a typo cannot widen the allowlist.
 */
export function parseExtensionIds(...values: (string | undefined)[]): string[] {
  const ids = values.flatMap((value) => (value ?? "").split(",")).map((id) => id.trim());
  return [...new Set(ids.filter((id) => EXTENSION_ID.test(id)))];
}

/** Returns why the request must be refused, or null when it may proceed to the session check. */
export function checkExtensionRequest(
  headers: Headers,
  extensionIds: readonly string[],
): JwordError | null {
  const allowed = extensionIds.map(extensionOrigin).filter((origin) => origin !== null);
  if (allowed.length === 0) {
    return new JwordError(
      "FORBIDDEN",
      "The capture API is not enabled on this jword server (JWORD_EXTENSION_IDS is not set).",
    );
  }
  if (!allowed.includes(headers.get("origin") ?? "")) {
    return new JwordError("FORBIDDEN", "Only the jword capture extension may call this API.");
  }
  if (!headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new JwordError("VALIDATION_ERROR", "Send a JSON request body.");
  }
  if (Number(headers.get("content-length") ?? 0) > EXTENSION_API_MAX_BYTES) {
    return new JwordError("VALIDATION_ERROR", "The request is too large.");
  }
  return null;
}

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  AMBIGUOUS_MATCH: 409,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}
