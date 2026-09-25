export const APPLICATION_STATUSES = [
  "SAVED",
  "RESEARCHING",
  "READY_TO_APPLY",
  "APPLIED",
  "OA",
  "INTERVIEW",
  "FINAL",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type ApplicationPriority = (typeof APPLICATION_PRIORITIES)[number];

export const WORK_ARRANGEMENTS = ["UNKNOWN", "REMOTE", "HYBRID", "ONSITE"] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const ACTIVITY_TYPES = [
  "CREATED",
  "STATUS_CHANGED",
  "DETAILS_UPDATED",
  "NOTE_ADDED",
  "NOTE_UPDATED",
  "IMPORTED",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTOR_TYPES = ["USER", "CODEX", "IMPORT", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Statuses that still represent a live opportunity (used for stale detection and counts). */
export const ACTIVE_STATUSES: readonly ApplicationStatus[] = [
  "SAVED",
  "RESEARCHING",
  "READY_TO_APPLY",
  "APPLIED",
  "OA",
  "INTERVIEW",
  "FINAL",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SAVED: "Saved",
  RESEARCHING: "Researching",
  READY_TO_APPLY: "Ready to apply",
  APPLIED: "Applied",
  OA: "Online assessment",
  INTERVIEW: "Interview",
  FINAL: "Final round",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const PRIORITY_LABELS: Record<ApplicationPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  UNKNOWN: "Unknown",
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CREATED: "Created",
  STATUS_CHANGED: "Status changed",
  DETAILS_UPDATED: "Details updated",
  NOTE_ADDED: "Note added",
  NOTE_UPDATED: "Note updated",
  IMPORTED: "Imported",
};

export const ACTOR_LABELS: Record<ActorType, string> = {
  USER: "You",
  CODEX: "Coding agent",
  IMPORT: "CSV import",
  SYSTEM: "System",
};

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function isApplicationPriority(value: unknown): value is ApplicationPriority {
  return typeof value === "string" && (APPLICATION_PRIORITIES as readonly string[]).includes(value);
}

export function isWorkArrangement(value: unknown): value is WorkArrangement {
  return typeof value === "string" && (WORK_ARRANGEMENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Company watchlist (decision 018)
// ---------------------------------------------------------------------------

/** Applicant-tracking system hosting a company's public job board. OTHER: no supported board. */
export const ATS_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY", "WORKDAY", "OTHER"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export const ATS_PROVIDER_LABELS: Record<AtsProvider, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  WORKDAY: "Workday",
  OTHER: "Other",
};

export const WATCH_EVENT_TYPES = [
  "WATCH_CREATED",
  "WATCH_UPDATED",
  "WATCH_ACTIVATED",
  "WATCH_DEACTIVATED",
  "WATCH_DELETED",
] as const;
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

export function isAtsProvider(value: unknown): value is AtsProvider {
  return typeof value === "string" && (ATS_PROVIDERS as readonly string[]).includes(value);
}
