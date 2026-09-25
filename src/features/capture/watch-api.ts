import type { BoardDiscoveryResult, CompanyOption, WatchMutationResult } from "@jword/core/browser";
import type { ActionResult } from "@/server/actions/result";

export interface WatchCaptureApi {
  searchCompanies(input: unknown): Promise<ActionResult<CompanyOption[]>>;
  verifyBoards(input: unknown): Promise<ActionResult<BoardDiscoveryResult>>;
  addWatch(input: unknown): Promise<ActionResult<WatchMutationResult>>;
}
