import type { SupportedBoardProvider } from "../watchlist/boards";

/** A provider's structured work arrangement (decision 026). Never inferred from descriptions. */
export const WORKPLACE_TYPES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

/** A provider's structured employment type, normalized (decision 026). */
export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "INTERN",
  "CONTRACT",
  "TEMPORARY",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** One posting read from a provider's public board (decision 024). Never fetched by URL later. */
export interface CollectedPosting {
  /** The provider's own stable posting id (Workday: its external path). */
  postingId: string;
  title: string;
  location: string | null;
  /** Built by jword from the provider host and the posting id, never copied from the response. */
  jobUrl: string;
  /** Plain text, trimmed to MAX_DESCRIPTION_LENGTH; null when the provider gave none. */
  description: string | null;
  /** YYYY-MM-DD when the provider supplies an absolute date; never inferred. */
  postedOn: string | null;
  /**
   * Every place the provider lists (primary first) when it gives more than one field;
   * otherwise omitted and `location` is the only place. At most MAX_LOCATIONS entries.
   */
  locations?: string[];
  /** From a structured provider field only (Ashby, Lever); omitted otherwise. */
  workplaceType?: WorkplaceType | null;
  /** From a structured provider field only (Ashby, Lever); omitted otherwise. */
  employmentType?: EmploymentType | null;
}

/**
 * complete: every posting was read, so postings not seen may be marked unavailable.
 * partial: some postings were read; nothing may be marked unavailable.
 * failed: nothing trustworthy was read (includes a board the provider no longer serves).
 */
export type CollectionStatus = "complete" | "partial" | "failed";

export const COLLECTION_REASONS = [
  "BOARD_NOT_FOUND",
  "PROVIDER_ERROR",
  "INVALID_RESPONSE",
  "TIME_LIMIT",
  "PAGE_FAILED",
  "TOTAL_CAPPED",
  "COUNT_MISMATCH",
  "POSTING_LIMIT",
  "INVALID_POSTINGS",
] as const;
export type CollectionReason = (typeof COLLECTION_REASONS)[number];

export interface CollectionResult {
  status: CollectionStatus;
  /** Why the scan was not complete; null when complete. */
  reason: CollectionReason | null;
  postings: CollectedPosting[];
  /** The provider's own total when it reports one (Workday caps it at 2000). */
  reportedTotal: number | null;
}

/** Reads every posting on one board. The real one lives in ./collector; tests use fixtures. */
export interface JobCollector {
  collect(
    provider: SupportedBoardProvider,
    identifier: string,
    signal?: AbortSignal,
  ): Promise<CollectionResult>;
}
