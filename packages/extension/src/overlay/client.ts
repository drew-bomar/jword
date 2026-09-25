import type { WatchCaptureApi } from "@/features/capture/watch-api";
import type {
  BoardDiscoveryResult,
  CompanyOption,
  WatchMutationResult,
  ApplicationDetail,
  ApplicationSummary,
  DuplicateCandidate,
  MutationResult,
} from "@jword/core/browser";
import type { CaptureApi } from "@/features/capture/api";
import type { ActionResult } from "@/server/actions/result";
import { MUTATION_OPS, type ApiOp, type OverlayRequest } from "../messages";

/** Send one request to the background worker; the nonce proves which capture this frame shows. */
export async function ask<T>(request: OverlayRequest): Promise<ActionResult<T>> {
  return (await chrome.runtime.sendMessage(request)) as ActionResult<T>;
}

function call<T>(nonce: string, op: ApiOp): (input: unknown) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      return await ask<T>({ type: "jword:api", nonce, op, input });
    } catch {
      // The worker never answered, so a save may still have reached jword.
      return MUTATION_OPS.has(op)
        ? {
            ok: false,
            error: {
              code: "OUTCOME_UNKNOWN",
              message: "The save is unconfirmed; retry the original save.",
            },
          }
        : {
            ok: false,
            error: { code: "INTERNAL_ERROR", message: "The jword extension did not answer." },
          };
    }
  };
}

/**
 * The review component's CaptureApi, implemented by messaging the background worker, which calls
 * jword's /api/extension/* endpoints (decision 017).
 */
export function backgroundApi(nonce: string): CaptureApi {
  return {
    findDuplicates: call<DuplicateCandidate[]>(nonce, "findDuplicates"),
    searchApplications: call<{ items: ApplicationSummary[]; hasMore: boolean }>(
      nonce,
      "searchApplications",
    ),
    getApplication: call<ApplicationDetail>(nonce, "getApplication"),
    createApplication: call<MutationResult>(nonce, "createApplication"),
    updatePosting: call<MutationResult>(nonce, "updatePosting"),
  };
}

export function backgroundWatchApi(nonce: string): WatchCaptureApi {
  return {
    searchCompanies: call<CompanyOption[]>(nonce, "searchCompanies"),
    verifyBoards: call<BoardDiscoveryResult>(nonce, "verifyBoards"),
    addWatch: call<WatchMutationResult>(nonce, "addWatch"),
  };
}
