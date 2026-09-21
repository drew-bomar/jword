import type {
  ActivityType,
  ActorType,
  ApplicationPriority,
  ApplicationStatus,
  WorkArrangement,
} from "./enums";

export interface ApplicationOverview {
  applicationId: string;
  jobId: string;
  companyId: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  version: number;
  location: string | null;
  workArrangement: WorkArrangement;
  jobUrl: string | null;
  externalJobId: string | null;
  source: string | null;
  dateFound: string | null;
  appliedAt: string | null;
  datePosted: string | null;
  resumeVersion: string | null;
  referral: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Search-result item: no notes or long descriptions (MCP rule). */
export interface ApplicationSummary {
  applicationId: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  version: number;
  location: string | null;
  appliedAt: string | null;
  lastActivityAt: string;
}

export interface ApplicationDetail extends ApplicationOverview {
  description: string | null;
}

export interface ApplicationNote {
  noteId: string;
  applicationId: string;
  body: string;
  noteDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationActivity {
  activityId: string;
  applicationId: string;
  type: ActivityType;
  actorType: ActorType;
  summary: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export type SearchSort = "updated" | "applied" | "company" | "priority";
export type SortDirection = "asc" | "desc";

export interface SearchQuery {
  text?: string;
  statuses?: ApplicationStatus[];
  priorities?: ApplicationPriority[];
  appliedFrom?: string;
  appliedTo?: string;
  /** Only applications whose last activity is before this ISO timestamp/date. */
  updatedBefore?: string;
  sort?: SearchSort;
  direction?: SortDirection;
  limit?: number;
  cursor?: string;
}

export interface StatusCounts {
  byStatus: Record<ApplicationStatus, number>;
  total: number;
  active: number;
}

export interface PipelineSummary extends StatusCounts {
  staleAfterDays: number;
  stale: ApplicationSummary[];
}

export interface CandidateProfile {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  school: string | null;
  degree: string | null;
  graduationDate: string | null;
  workAuthorization: string | null;
  requiresSponsorship: boolean | null;
  updatedAt: string | null;
}

export type SafeScalar = string | null;

/** Shape returned by every mutation (tooling spec "Mutation result contract"). */
export interface MutationResult {
  ok: true;
  operation: string;
  requestId: string;
  replayed: boolean;
  noop: boolean;
  applicationId?: string;
  jobId?: string;
  companyId?: string;
  noteId?: string | null;
  version?: number;
  activityId?: string | null;
  summary: string;
  changedFields: string[];
  before: Record<string, SafeScalar>;
  after: Record<string, SafeScalar>;
  /** Import batches only. */
  imported?: number;
  applicationIds?: string[];
}
