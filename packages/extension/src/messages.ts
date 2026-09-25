import type { CapturedPosting } from "@jword/core/browser";

/**
 * Messages between the overlay frame, the background worker, and the page host (decision 017).
 * The overlay never calls jword itself: it asks the background worker, which holds the only
 * network path and checks that each message comes from the overlay frame of a captured tab.
 */

/** Overlay operation -> jword endpoint under /api/extension/. The only calls that exist. */
export const API_ENDPOINTS = {
  searchCompanies: "search-companies",
  verifyBoards: "verify-boards",
  addWatch: "add-watch",
  findDuplicates: "find-duplicates",
  searchApplications: "search-applications",
  getApplication: "get-application",
  createApplication: "create-application",
  updatePosting: "update-posting",
} as const;
export type ApiOp = keyof typeof API_ENDPOINTS;

/** A lost response to these may still have saved; the caller must retry the identical command. */
export const MUTATION_OPS: ReadonlySet<ApiOp> = new Set([
  "createApplication",
  "updatePosting",
  "addWatch",
]);

export function isApiOp(value: unknown): value is ApiOp {
  return typeof value === "string" && Object.hasOwn(API_ENDPOINTS, value);
}

/** Same shape as jword's ActionResult, so the shared review component can consume it. */
export type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; [key: string]: unknown } };

/** Overlay frame -> background. `nonce` ties the frame to one capture of one tab. */
export type OverlayRequest =
  | { type: "jword:overlay-hello"; nonce: string }
  | { type: "jword:api"; nonce: string; op: ApiOp; input: unknown }
  | { type: "jword:overlay-close"; nonce: string }
  | { type: "jword:open-options"; nonce: string };

export interface OverlayCapture {
  /** Already validated and fitted to jword's limits by the background worker. */
  posting: CapturedPosting;
  /** jword origin, e.g. http://localhost:3200; used for links that open jword in a tab. */
  jwordUrl: string;
}

/** Background -> page host (top frame of the captured tab). */
export const REMOVE_OVERLAY = "jword:overlay-remove";
