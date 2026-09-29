import type { CityKey } from "./cities";

/**
 * NEW_GRAD excludes clearly senior/staff/principal/lead and people-management titles;
 * ANY turns those seniority rules off.
 */
export const TARGET_LEVELS = ["NEW_GRAD", "ANY"] as const;
export type TargetLevel = (typeof TARGET_LEVELS)[number];
export const TARGET_LEVEL_LABELS: Record<TargetLevel, string> = {
  NEW_GRAD: "New graduate / entry level",
  ANY: "Any level",
};

/** FULL_TIME excludes explicit internships and co-ops; ANY keeps them. */
export const EMPLOYMENT_TARGETS = ["FULL_TIME", "ANY"] as const;
export type EmploymentTarget = (typeof EMPLOYMENT_TARGETS)[number];
export const EMPLOYMENT_TARGET_LABELS: Record<EmploymentTarget, string> = {
  FULL_TIME: "Full-time (no internships)",
  ANY: "Any, including internships",
};

/** Role families recognized from titles. Only labels and filters; never a hard exclusion. */
export const ROLE_FAMILIES = [
  "BACKEND",
  "FRONTEND",
  "FULL_STACK",
  "PLATFORM_INFRA",
  "AI_ML",
  "DATA",
  "MOBILE",
  "SECURITY",
  "EMBEDDED",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  BACKEND: "Backend",
  FRONTEND: "Frontend",
  FULL_STACK: "Full stack",
  PLATFORM_INFRA: "Platform / infrastructure",
  AI_ML: "AI / ML / agents",
  DATA: "Data",
  MOBILE: "Mobile",
  SECURITY: "Security",
  EMBEDDED: "Embedded / hardware",
};

export const MAX_PREFERRED_CITIES = 10;

/** The owner's search preferences (decision 026). Separate from the factual candidate profile. */
export interface SearchPreferences {
  targetLevel: TargetLevel;
  employmentTarget: EmploymentTarget;
  /** First day of the preferred start month, YYYY-MM-01; null = no preference. */
  preferredStartMonth: string | null;
  /** Ordered; the first is most preferred. */
  preferredCities: CityKey[];
  /** Default Leads view hides postings that are explicitly remote-only. */
  hideRemoteOnly: boolean;
  preferredRoles: RoleFamily[];
  deemphasizedRoles: RoleFamily[];
  /** Hide postings whose stated date is older than this; null = off. Undated postings stay. */
  maxPostingAgeDays: number | null;
  version: number;
  updatedAt: string;
}

/** Neutral behavior when the owner has not saved preferences: nothing is excluded. */
export const NEUTRAL_PREFERENCES: Omit<SearchPreferences, "version" | "updatedAt"> = {
  targetLevel: "ANY",
  employmentTarget: "ANY",
  preferredStartMonth: null,
  preferredCities: [],
  hideRemoteOnly: false,
  preferredRoles: [],
  deemphasizedRoles: [],
  maxPostingAgeDays: null,
};

export interface PreferencesMutationResult {
  ok: true;
  operation: string;
  requestId: string;
  replayed: boolean;
  noop: boolean;
  version: number;
  activityId: string | null;
  summary: string;
  /** Leads whose deterministic evaluation was refreshed after the save. */
  reevaluated?: number;
  /** Preferences committed, but derived lead labels still need a retry. */
  reevaluationPending?: boolean;
}
