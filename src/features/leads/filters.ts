import type {
  LeadAvailability,
  LeadReviewStatus,
  LeadRoleFilter,
  LeadSort,
  LeadView,
} from "@jword/core/browser";

// Shared by the server page and the client filter bar. Kept out of the "use client" module:
// a Server Component importing a value from a client module receives a client reference, not
// the value itself.

/** The inbox shows New leads unless another review status (or all) is chosen. */
export type LeadStatusFilter = LeadReviewStatus | "all";

export interface LeadFilters {
  q: string;
  company: string;
  status: LeadStatusFilter;
  availability: LeadAvailability | "";
  /** Decision 026 views; Recommended by default. */
  view: LeadView;
  sort: LeadSort;
  role: LeadRoleFilter | "";
}

export const DEFAULT_LEAD_STATUS: LeadStatusFilter = "NEW";
export const DEFAULT_LEAD_VIEW: LeadView = "RECOMMENDED";
export const DEFAULT_LEAD_SORT: LeadSort = "NEWEST";
