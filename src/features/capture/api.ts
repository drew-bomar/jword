import type {
  ApplicationDetail,
  ApplicationSummary,
  DuplicateCandidate,
  MutationResult,
} from "@jword/core/browser";
import type { ActionResult } from "@/server/actions/result";

/**
 * What the capture review needs from jword (decision 017). The extension overlay implements it by
 * messaging its background worker, which calls the /api/extension/* Route Handlers. Inputs are
 * `unknown` on purpose: the server validates them with the shared schemas.
 */
export interface CaptureApi {
  findDuplicates(input: unknown): Promise<ActionResult<DuplicateCandidate[]>>;
  searchApplications(
    input: unknown,
  ): Promise<ActionResult<{ items: ApplicationSummary[]; hasMore: boolean }>>;
  getApplication(input: unknown): Promise<ActionResult<ApplicationDetail>>;
  createApplication(input: unknown): Promise<ActionResult<MutationResult>>;
  updatePosting(input: unknown): Promise<ActionResult<MutationResult>>;
}
