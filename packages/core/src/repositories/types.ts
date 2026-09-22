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
  UpdateApplicationDetailsCommand,
  UpdateApplicationNoteCommand,
  UpdateApplicationStatusCommand,
} from "../validation/schemas";

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

  getCandidateProfile(userId: string): Promise<CandidateProfile | null>;
  saveCandidateProfile(userId: string, command: CandidateProfileCommand): Promise<CandidateProfile>;
}
