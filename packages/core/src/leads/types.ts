import type {
  CollectedPosting,
  CollectionReason,
  EmploymentType,
  WorkplaceType,
} from "../collection/types";
import type { LeadArrangement, LeadEvaluation, LeadMatch, RoleFit } from "./evaluate";
import type { ActorType } from "../domain/enums";
import type { MutationResult } from "../domain/types";
import type { SupportedBoardProvider } from "../watchlist/boards";

/** The owner's decision about a lead. Separate from whether the posting is still listed. */
export const LEAD_REVIEW_STATUSES = ["NEW", "DISMISSED", "PROMOTED"] as const;
export type LeadReviewStatus = (typeof LEAD_REVIEW_STATUSES)[number];
export const LEAD_REVIEW_LABELS: Record<LeadReviewStatus, string> = {
  NEW: "New",
  DISMISSED: "Dismissed",
  PROMOTED: "Application created",
};

/** Whether the latest complete scan still listed the posting. Never set from a partial scan. */
export const LEAD_AVAILABILITIES = ["AVAILABLE", "UNAVAILABLE"] as const;
export type LeadAvailability = (typeof LEAD_AVAILABILITIES)[number];
export const LEAD_AVAILABILITY_LABELS: Record<LeadAvailability, string> = {
  AVAILABLE: "Listed",
  UNAVAILABLE: "No longer listed",
};

export const LEAD_EVENT_TYPES = ["LEAD_DISMISSED", "LEAD_RESTORED", "LEAD_PROMOTED"] as const;
export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

/** A posting collected from a watched board (decision 024). */
export interface Lead {
  leadId: string;
  companyId: string;
  company: string;
  sourceId: string;
  provider: SupportedBoardProvider;
  boardIdentifier: string;
  postingId: string;
  title: string;
  location: string | null;
  jobUrl: string;
  postedOn: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  availability: LeadAvailability;
  unavailableAt: string | null;
  reviewStatus: LeadReviewStatus;
  applicationId: string | null;
  version: number;
  /** Every listed place when the provider gave several; otherwise empty (see `location`). */
  locations: string[];
  workplaceType: WorkplaceType | null;
  employmentType: EmploymentType | null;
  /** Deterministic evaluation (decision 026); null until first evaluated (treated as eligible). */
  match: LeadMatch | null;
  arrangement: LeadArrangement;
  cityRank: number | null;
  roleFit: RoleFit;
  evaluation: LeadEvaluation | null;
}

export interface LeadDetail extends Lead {
  description: string | null;
}

/**
 * Inbox views (decision 026). RECOMMENDED hides filtered-out leads, and remote-only leads when
 * the owner prefers; REMOTE shows only remote-only leads; FILTERED shows leads a hard rule
 * now excludes; ALL shows everything. The posting-age limit applies to RECOMMENDED and REMOTE.
 */
export const LEAD_VIEWS = ["RECOMMENDED", "REMOTE", "FILTERED", "ALL"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export const LEAD_VIEW_LABELS: Record<LeadView, string> = {
  RECOMMENDED: "Recommended",
  REMOTE: "Remote only",
  FILTERED: "Filtered out",
  ALL: "All",
};

export const LEAD_SORTS = ["NEWEST", "CITY"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];
export const LEAD_SORT_LABELS: Record<LeadSort, string> = {
  NEWEST: "Newest first",
  CITY: "Preferred city first",
};

export const LEAD_ROLE_FILTERS = ["PREFERRED", "NOT_DEEMPHASIZED"] as const;
export type LeadRoleFilter = (typeof LEAD_ROLE_FILTERS)[number];
export const LEAD_ROLE_FILTER_LABELS: Record<LeadRoleFilter, string> = {
  PREFERRED: "Preferred roles only",
  NOT_DEEMPHASIZED: "Hide de-emphasized roles",
};

/** Repository-level filters; the service turns a view and preferences into these. */
export interface LeadListQuery {
  text?: string;
  companyId?: string;
  reviewStatus?: LeadReviewStatus;
  availability?: LeadAvailability;
  /** NOT_EXCLUDED keeps unevaluated leads (unknown means eligible). */
  match?: "NOT_EXCLUDED" | "EXCLUDED";
  arrangement?: "REMOTE" | "NOT_REMOTE";
  /** Keeps leads with no stated posting date. */
  postedOnOrAfter?: string;
  role?: LeadRoleFilter;
  sort?: LeadSort;
  limit: number;
  cursor?: string;
}

export interface LeadCompany {
  companyId: string;
  company: string;
  leadCount: number;
}

/**
 * Collector reasons plus check-level ones: UNSUPPORTED_BOARD (a careers page), IN_PROGRESS
 * (another check of the same board is running), NOT_CHECKED (the check's time budget ran out
 * or the board left the watch), SAVE_FAILED (postings could not all be saved).
 */
export type BoardCheckReason =
  | CollectionReason
  | "UNSUPPORTED_BOARD"
  | "IN_PROGRESS"
  | "NOT_CHECKED"
  | "SAVE_FAILED"
  | "FINISH_UNCONFIRMED";

/** Board outcome of one check. `unsupported` is a careers page jword cannot read. */
export type BoardCheckStatus = "complete" | "partial" | "failed" | "unsupported";

export interface BoardCheckReport {
  watchId: string;
  companyId: string;
  company: string;
  provider: SupportedBoardProvider | "OTHER";
  boardIdentifier: string | null;
  boardUrl: string;
  status: BoardCheckStatus;
  /** Why the board was not complete; null when complete. */
  reason: BoardCheckReason | null;
  /** Postings read in this check. */
  found: number;
  /** Postings seen for the first time. */
  created: number;
  /** Known postings whose title, location, link, description, or date changed. */
  updated: number;
  /** Postings listed again after a complete scan had marked them unavailable. */
  relisted: number;
  /** Postings a complete scan no longer found. Always 0 unless status is complete. */
  markedUnavailable: number;
  /** New postings not stored because a hard rule excluded them, by primary reason. */
  filtered: number;
  filteredReasons: Record<string, number>;
  reportedTotal: number | null;
}

export interface JobCheckTotals {
  boards: number;
  complete: number;
  partial: number;
  failed: number;
  unsupported: number;
  found: number;
  created: number;
  updated: number;
  relisted: number;
  markedUnavailable: number;
  filtered: number;
  filteredReasons: Record<string, number>;
}

export interface JobCheckResult {
  /** The one watch checked, or null for all active watches. */
  watchId: string | null;
  boards: BoardCheckReport[];
  totals: JobCheckTotals;
  /** Existing leads re-evaluated after the check (older snapshot or never evaluated). */
  reevaluated: number;
}

export interface LeadScanStart {
  scanId: string;
  sourceId: string;
}

export interface LeadPostingCounts {
  created: number;
  updated: number;
  relisted: number;
  filtered: number;
  filteredReasons: Record<string, number>;
}

/** The evaluation as stored with a lead; `detail` is the full evaluator output. */
export interface StoredLeadEvaluation {
  match: LeadMatch;
  arrangement: LeadArrangement;
  cityRank: number | null;
  roleFit: RoleFit;
  key: string;
  /** The first exclusion code; set only when EXCLUDED. */
  primaryReason: string | null;
  detail: LeadEvaluation;
}

/** A collected posting with the scan's evaluation of it. */
export interface EvaluatedPosting extends CollectedPosting {
  evaluation?: StoredLeadEvaluation;
}

/** The stored fields the evaluator reads, for re-evaluation. */
export interface LeadEvaluationInput {
  leadId: string;
  /** Changes with evaluator inputs, independently of the user's review version. */
  inputRevision: number;
  title: string;
  location: string | null;
  locations: string[];
  workplaceType: WorkplaceType | null;
  employmentType: EmploymentType | null;
  description: string | null;
}

export interface LeadMutationResult {
  ok: true;
  operation: string;
  requestId: string;
  replayed: boolean;
  noop: boolean;
  leadId: string;
  version: number;
  reviewStatus: LeadReviewStatus;
  applicationId: string | null;
  activityId: string | null;
  summary: string;
  /** Present when the lead became an application. */
  application?: MutationResult;
}

export interface LeadActivity {
  activityId: string;
  leadId: string;
  type: LeadEventType;
  actorType: ActorType;
  summary: string;
  occurredAt: string;
}
