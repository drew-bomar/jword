import type { ActorContext } from "../domain/actor";
import type { ApplicationStatus } from "../domain/enums";
import type {
  ApplicationActivity,
  ApplicationDetail,
  ApplicationNote,
  ApplicationOverview,
  CandidateProfile,
  MutationResult,
  Page,
  SearchQuery,
} from "../domain/types";
import type { DuplicateIndexEntry } from "../import/validate";
import type {
  AddApplicationNoteCommand,
  CandidateProfileCommand,
  CommitImportCommand,
  CreateApplicationCommand,
  DeleteApplicationCommand,
  UpdateApplicationDetailsCommand,
  UpdateApplicationNoteCommand,
  UpdateApplicationStatusCommand,
} from "../validation/schemas";
import type {
  AddWatchedCompanyCommand,
  DeleteWatchedCompanyCommand,
  SetCompanyWatchStatusCommand,
  UpdateWatchedCompanyCommand,
} from "../watchlist/schemas";
import type {
  CompanyOption,
  CompanyRef,
  WatchSummary,
  WatchActivity,
  WatchedCompany,
  WatchListQuery,
  WatchMutationResult,
} from "../watchlist/types";

import type {
  CreateApplicationFromLeadCommand,
  SetLeadReviewStatusCommand,
} from "../leads/schemas";
import type {
  EvaluatedPosting,
  Lead,
  LeadCompany,
  LeadDetail,
  LeadEvaluationInput,
  LeadListQuery,
  LeadMutationResult,
  LeadPostingCounts,
  LeadScanStart,
  StoredLeadEvaluation,
} from "../leads/types";
import type { SaveSearchPreferencesCommand } from "../preferences/schemas";
import type { PreferencesMutationResult, SearchPreferences } from "../preferences/types";
import type { SupportedBoardProvider } from "../watchlist/boards";

export interface MutationContext {
  actor: ActorContext;
  /** Today's date in the owner's timezone for interactive defaults; null for imports. */
  today: string | null;
}

export interface PageRequest {
  limit: number;
  cursor?: string;
}

/**
 * Repository contract. Every operation receives the owner explicitly and must scope to it,
 * because the MCP path uses a credential that bypasses RLS.
 */
export interface TrackerRepository {
  searchApplications(
    userId: string,
    query: Required<Pick<SearchQuery, "limit">> & SearchQuery,
  ): Promise<Page<ApplicationOverview>>;
  getApplication(userId: string, applicationId: string): Promise<ApplicationDetail | null>;
  listNotes(
    userId: string,
    applicationId: string,
    page: PageRequest,
  ): Promise<Page<ApplicationNote>>;
  listActivity(
    userId: string,
    applicationId: string,
    page: PageRequest,
  ): Promise<Page<ApplicationActivity>>;
  listStatuses(userId: string): Promise<ApplicationStatus[]>;
  listDuplicateIndex(userId: string): Promise<DuplicateIndexEntry[]>;

  createApplication(
    ctx: MutationContext,
    command: CreateApplicationCommand,
  ): Promise<MutationResult>;
  updateApplicationStatus(
    ctx: MutationContext,
    command: UpdateApplicationStatusCommand,
  ): Promise<MutationResult>;
  updateApplicationDetails(
    ctx: MutationContext,
    command: UpdateApplicationDetailsCommand,
  ): Promise<MutationResult>;
  addApplicationNote(
    ctx: MutationContext,
    command: AddApplicationNoteCommand,
  ): Promise<MutationResult>;
  updateApplicationNote(
    ctx: MutationContext,
    command: UpdateApplicationNoteCommand,
  ): Promise<MutationResult>;
  importApplications(ctx: MutationContext, command: CommitImportCommand): Promise<MutationResult>;
  deleteApplication(
    ctx: MutationContext,
    command: DeleteApplicationCommand,
  ): Promise<MutationResult>;

  getCandidateProfile(userId: string): Promise<CandidateProfile | null>;
  saveCandidateProfile(userId: string, command: CandidateProfileCommand): Promise<CandidateProfile>;
}

/**
 * Watchlist repository contract (decision 018). Same owner-scoping rule as the tracker:
 * every operation receives the owner explicitly.
 */
export interface WatchlistRepository {
  listWatches(userId: string, query: WatchListQuery): Promise<Page<WatchedCompany>>;
  getWatch(userId: string, watchId: string): Promise<WatchedCompany | null>;
  listWatchActivity(
    userId: string,
    watchId: string,
    page: PageRequest,
  ): Promise<Page<WatchActivity>>;
  searchCompanies(userId: string, text: string, limit: number): Promise<CompanyOption[]>;

  createWatch(
    ctx: MutationContext,
    command: AddWatchedCompanyCommand,
  ): Promise<WatchMutationResult>;
  updateWatch(
    ctx: MutationContext,
    command: UpdateWatchedCompanyCommand,
  ): Promise<WatchMutationResult>;
  deleteWatch(
    ctx: MutationContext,
    command: DeleteWatchedCompanyCommand,
  ): Promise<WatchMutationResult>;
  setWatchActive(
    ctx: MutationContext,
    command: SetCompanyWatchStatusCommand,
  ): Promise<WatchMutationResult>;

  // Board discovery (decision 019): local reads only; network lookups go through BoardDirectory.
  getCompany(userId: string, companyId: string): Promise<CompanyRef | null>;
  findCompanyByName(userId: string, name: string): Promise<CompanyRef | null>;
  listCompanyJobUrls(userId: string, companyId: string): Promise<string[]>;
  listApplicationJobUrls(
    userId: string,
  ): Promise<Array<{ companyId: string; company: string; jobUrl: string }>>;
  listWatchSummaries(userId: string): Promise<WatchSummary[]>;
}

/**
 * Leads repository contract (decision 024). Scans are written in three steps so large boards
 * can be saved in chunks; only finishing a COMPLETE scan marks unseen postings unavailable.
 */
export interface LeadsRepository {
  beginLeadScan(
    ctx: MutationContext,
    board: { watchId: string; provider: SupportedBoardProvider; boardIdentifier: string },
  ): Promise<LeadScanStart>;
  /** New postings evaluated EXCLUDED are counted, not stored; known postings are refreshed. */
  recordLeadPostings(
    ctx: MutationContext,
    scanId: string,
    postings: EvaluatedPosting[],
  ): Promise<LeadPostingCounts>;
  finishLeadScan(
    ctx: MutationContext,
    scan: {
      scanId: string;
      status: "COMPLETE" | "PARTIAL" | "FAILED";
      reason: string | null;
      reportedTotal: number | null;
    },
  ): Promise<{ markedUnavailable: number }>;

  listLeads(userId: string, query: LeadListQuery): Promise<Page<Lead>>;
  getLead(userId: string, leadId: string): Promise<LeadDetail | null>;
  listLeadCompanies(userId: string): Promise<LeadCompany[]>;

  setLeadReviewStatus(
    ctx: MutationContext,
    command: SetLeadReviewStatusCommand,
  ): Promise<LeadMutationResult>;
  createApplicationFromLead(
    ctx: MutationContext,
    command: CreateApplicationFromLeadCommand,
  ): Promise<LeadMutationResult>;

  // Search preferences and stored evaluations (decision 026).
  getSearchPreferences(userId: string): Promise<SearchPreferences | null>;
  saveSearchPreferences(
    ctx: MutationContext,
    command: SaveSearchPreferencesCommand,
  ): Promise<PreferencesMutationResult>;
  /** Leads whose stored evaluation key differs from `key`, by lead id after `afterId`. */
  listLeadsToEvaluate(
    userId: string,
    query: { key: string; afterId?: string; limit: number },
  ): Promise<LeadEvaluationInput[]>;
  /** Rejects stale preferences/profile snapshots; skips postings whose inputs have changed. */
  applyLeadEvaluations(
    ctx: MutationContext,
    preferencesVersion: number,
    evaluations: Array<{
      leadId: string;
      expectedInputRevision: number;
      evaluation: StoredLeadEvaluation;
    }>,
    graduationDate: string | null,
  ): Promise<{ updated: number }>;
}
