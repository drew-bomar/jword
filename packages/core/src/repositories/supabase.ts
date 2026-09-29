import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../db/database.types";
import type { ApplicationStatus } from "../domain/enums";
import { JwordError } from "../domain/errors";
import { normalizeName } from "../domain/normalize";
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
import { stripUndefined } from "../validation/schemas";
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
  SafeWatchValue,
  WatchBoard,
  WatchSummary,
  WatchActivity,
  WatchedCompany,
  WatchListQuery,
  WatchMutationResult,
} from "../watchlist/types";
import type { EmploymentType, WorkplaceType } from "../collection/types";
import type { LeadArrangement, LeadMatch, RoleFit } from "../leads/evaluate";
import { parseLeadEvaluation } from "../leads/evaluation-schema";
import type { SaveSearchPreferencesCommand } from "../preferences/schemas";
import type { CityKey } from "../preferences/cities";
import type {
  EmploymentTarget,
  PreferencesMutationResult,
  RoleFamily,
  SearchPreferences,
  TargetLevel,
} from "../preferences/types";
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
  LeadReviewStatus,
  LeadScanStart,
  StoredLeadEvaluation,
} from "../leads/types";
import type { SupportedBoardProvider } from "../watchlist/boards";
import { decodeCursor, encodeCursor, filterKeyFor } from "./cursor";
import { mapDatabaseError } from "./errors";
import type {
  LeadsRepository,
  MutationContext,
  PageRequest,
  TrackerRepository,
  WatchlistRepository,
} from "./types";

export type JwordSupabaseClient = SupabaseClient<Database>;

type OverviewRow = Database["public"]["Views"]["application_overview"]["Row"];
type NoteRow = Database["public"]["Tables"]["application_notes"]["Row"];
type ActivityRow = Database["public"]["Tables"]["application_activities"]["Row"];
type ProfileRow = Database["public"]["Tables"]["candidate_profiles"]["Row"];
type WatchRow = Database["public"]["Views"]["company_watch_overview"]["Row"];
type WatchActivityRow = Database["public"]["Tables"]["company_watch_activities"]["Row"];
type LeadRow = Database["public"]["Views"]["lead_overview"]["Row"];
type PreferencesRow = Database["public"]["Tables"]["search_preferences"]["Row"];

/** Postings per record_lead_postings call; the SQL function accepts at most 500. */
const POSTING_CHUNK = 250;

const SORT_COLUMNS = {
  updated: "last_activity_at",
  applied: "applied_at",
  company: "company_name",
  priority: "priority",
} as const;

function mapOverview(row: OverviewRow): ApplicationOverview & { description: string | null } {
  return {
    applicationId: row.application_id!,
    jobId: row.job_id!,
    companyId: row.company_id!,
    company: row.company_name!,
    title: row.title!,
    status: row.status!,
    priority: row.priority!,
    version: row.version!,
    location: row.location,
    workArrangement: row.work_arrangement!,
    jobUrl: row.job_url,
    externalJobId: row.external_job_id,
    source: row.source,
    dateFound: row.date_found,
    appliedAt: row.applied_at,
    datePosted: row.date_posted,
    resumeVersion: row.resume_version,
    referral: row.referral,
    lastActivityAt: row.last_activity_at!,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
    description: row.description,
  };
}

function mapNote(row: NoteRow): ApplicationNote {
  return {
    noteId: row.id,
    applicationId: row.application_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivity(row: ActivityRow): ApplicationActivity {
  return {
    activityId: row.id,
    applicationId: row.application_id,
    type: row.type,
    actorType: row.actor_type,
    summary: row.summary,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function mapProfile(row: ProfileRow): CandidateProfile {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    portfolioUrl: row.portfolio_url,
    school: row.school,
    degree: row.degree,
    graduationDate: row.graduation_date,
    workAuthorization: row.work_authorization,
    requiresSponsorship: row.requires_sponsorship,
    updatedAt: row.updated_at,
  };
}

function mapWatch(row: WatchRow): WatchedCompany {
  return {
    watchId: row.watch_id!,
    companyId: row.company_id!,
    company: row.company_name!,
    boards: (Array.isArray(row.boards) ? row.boards : []) as unknown as WatchBoard[],
    active: row.active!,
    version: row.version!,
    interestLevel: row.interest_level,
    websiteUrl: row.website_url,
    companyNotes: row.company_notes,
    applicationCount: row.application_count ?? 0,
    lastEvent:
      row.last_event_type && row.last_event_actor_type && row.last_event_at
        ? {
            type: row.last_event_type,
            actorType: row.last_event_actor_type,
            summary: row.last_event_summary ?? "",
            occurredAt: row.last_event_at,
          }
        : null,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
}

function mapWatchActivity(row: WatchActivityRow): WatchActivity {
  return {
    activityId: row.id,
    watchId: row.original_watch_id,
    type: row.type,
    actorType: row.actor_type,
    summary: row.summary,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function asWatchResult(value: Json, operation: string): WatchMutationResult {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw) || raw.ok !== true) {
    throw new JwordError("INTERNAL_ERROR", `${operation} returned an unexpected result.`);
  }
  const record = (entry: unknown) => (entry ?? {}) as Record<string, SafeWatchValue>;
  return {
    ok: true,
    operation: String(raw.operation ?? operation),
    requestId: String(raw.requestId ?? ""),
    replayed: raw.replayed === true,
    noop: raw.noop === true,
    watchId: String(raw.watchId ?? ""),
    companyId: String(raw.companyId ?? ""),
    company: String(raw.company ?? ""),
    ...(typeof raw.companyCreated === "boolean" ? { companyCreated: raw.companyCreated } : {}),
    ...(raw.deleted === true ? { deleted: true } : {}),
    active: raw.active === true,
    version: typeof raw.version === "number" ? raw.version : 0,
    activityId: typeof raw.activityId === "string" ? raw.activityId : null,
    summary: String(raw.summary ?? ""),
    changedFields: Array.isArray(raw.changedFields) ? (raw.changedFields as string[]) : [],
    before: record(raw.before),
    after: record(raw.after),
  };
}

/** PostgREST `or()` filter values: strip characters with syntax meaning and wildcards. */
function mapLead(row: LeadRow): Lead {
  return {
    leadId: row.lead_id!,
    companyId: row.company_id!,
    company: row.company_name!,
    sourceId: row.source_id!,
    provider: row.provider as SupportedBoardProvider,
    boardIdentifier: row.board_identifier!,
    postingId: row.provider_posting_id!,
    title: row.title!,
    location: row.location,
    jobUrl: row.job_url!,
    postedOn: row.posted_on,
    firstSeenAt: row.first_seen_at!,
    lastSeenAt: row.last_seen_at!,
    availability: row.availability!,
    unavailableAt: row.unavailable_at,
    reviewStatus: row.review_status!,
    applicationId: row.application_id,
    version: row.version!,
    locations: row.locations ?? [],
    workplaceType: (row.workplace_type as WorkplaceType | null) ?? null,
    employmentType: (row.employment_type as EmploymentType | null) ?? null,
    match: (row.match_status as LeadMatch | null) ?? null,
    arrangement: (row.arrangement as LeadArrangement | null) ?? "UNKNOWN",
    cityRank: row.city_rank,
    roleFit: (row.role_fit as RoleFit | null) ?? "NEUTRAL",
    evaluation: parseLeadEvaluation(row.evaluation),
  };
}

function mapPreferences(row: PreferencesRow): SearchPreferences {
  return {
    targetLevel: row.target_level as TargetLevel,
    employmentTarget: row.employment_target as EmploymentTarget,
    preferredStartMonth: row.preferred_start_month?.slice(0, 7) ?? null,
    preferredCities: row.preferred_cities as CityKey[],
    hideRemoteOnly: row.hide_remote_only,
    preferredRoles: row.preferred_roles as RoleFamily[],
    deemphasizedRoles: row.deemphasized_roles as RoleFamily[],
    maxPostingAgeDays: row.max_posting_age_days,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function asLeadResult(value: Json, operation: string): LeadMutationResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).ok !== true
  ) {
    throw new JwordError("INTERNAL_ERROR", `${operation} returned an unexpected result.`);
  }
  const raw = value as Record<string, unknown>;
  return {
    ok: true,
    operation: String(raw.operation ?? operation),
    requestId: String(raw.requestId ?? ""),
    replayed: raw.replayed === true,
    noop: raw.noop === true,
    leadId: String(raw.leadId),
    version: Number(raw.version),
    reviewStatus: raw.reviewStatus as LeadReviewStatus,
    applicationId: typeof raw.applicationId === "string" ? raw.applicationId : null,
    activityId: typeof raw.activityId === "string" ? raw.activityId : null,
    summary: String(raw.summary ?? ""),
    ...(raw.application
      ? { application: asMutationResult(raw.application as Json, operation) }
      : {}),
  };
}

function sanitizeSearchText(text: string): string {
  return text.replace(/[%_,()"'\\]/g, " ").trim();
}

function asMutationResult(value: Json, operation: string): MutationResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).ok !== true
  ) {
    throw new JwordError("INTERNAL_ERROR", `${operation} returned an unexpected result.`);
  }
  const raw = value as Record<string, unknown>;
  return {
    ok: true,
    operation: String(raw.operation ?? operation),
    requestId: String(raw.requestId ?? ""),
    replayed: raw.replayed === true,
    noop: raw.noop === true,
    applicationId: typeof raw.applicationId === "string" ? raw.applicationId : undefined,
    jobId: typeof raw.jobId === "string" ? raw.jobId : undefined,
    companyId: typeof raw.companyId === "string" ? raw.companyId : undefined,
    noteId: typeof raw.noteId === "string" ? raw.noteId : null,
    version: typeof raw.version === "number" ? raw.version : undefined,
    activityId: typeof raw.activityId === "string" ? raw.activityId : null,
    summary: String(raw.summary ?? ""),
    changedFields: Array.isArray(raw.changedFields) ? (raw.changedFields as string[]) : [],
    before: (raw.before as Record<string, string | null>) ?? {},
    after: (raw.after as Record<string, string | null>) ?? {},
    imported: typeof raw.imported === "number" ? raw.imported : undefined,
    ...(raw.deleted === true ? { deleted: true } : {}),
    ...(Array.isArray(raw.restoredLeadIds)
      ? { restoredLeadIds: raw.restoredLeadIds as string[] }
      : {}),
    applicationIds: Array.isArray(raw.applicationIds)
      ? (raw.applicationIds as string[])
      : undefined,
  };
}

/**
 * Supabase-backed repository. Works with either an authenticated user session client
 * (web; RLS applies) or the local service-role client (MCP; RLS bypassed, so every query
 * filters by user_id and every RPC passes the owner explicitly).
 */
export class SupabaseTrackerRepository
  implements TrackerRepository, WatchlistRepository, LeadsRepository
{
  constructor(private readonly client: JwordSupabaseClient) {}

  async searchApplications(
    userId: string,
    query: Required<Pick<SearchQuery, "limit">> & SearchQuery,
  ): Promise<Page<ApplicationOverview>> {
    const { cursor, limit, ...filters } = query;
    const filterKey = filterKeyFor({ ...filters, userId });
    const offset = decodeCursor(cursor, filterKey);

    let request = this.client.from("application_overview").select("*").eq("user_id", userId);
    const text = query.text ? sanitizeSearchText(query.text) : "";
    if (text) {
      request = request.or(`company_name.ilike.%${text}%,title.ilike.%${text}%`);
    }
    if (query.statuses?.length) request = request.in("status", query.statuses);
    if (query.priorities?.length) request = request.in("priority", query.priorities);
    if (query.appliedFrom) request = request.gte("applied_at", query.appliedFrom);
    if (query.appliedTo) request = request.lte("applied_at", query.appliedTo);
    if (query.updatedBefore) request = request.lt("last_activity_at", query.updatedBefore);

    const sort = query.sort ?? "updated";
    const ascending = (query.direction ?? (sort === "company" ? "asc" : "desc")) === "asc";
    request = request.order(SORT_COLUMNS[sort], { ascending, nullsFirst: false });
    if (sort === "company") request = request.order("title", { ascending: true });
    request = request.order("application_id", { ascending: true }).range(offset, offset + limit);

    const { data, error } = await request;
    if (error) throw mapDatabaseError(error, "search");
    const rows = (data ?? []) as OverviewRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => {
      const { description: _description, ...overview } = mapOverview(row);
      return overview;
    });
    return {
      items,
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + limit, filterKey) : null,
    };
  }

  async getApplication(userId: string, applicationId: string): Promise<ApplicationDetail | null> {
    const { data, error } = await this.client
      .from("application_overview")
      .select("*")
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get application");
    return data ? mapOverview(data as OverviewRow) : null;
  }

  async listNotes(
    userId: string,
    applicationId: string,
    page: PageRequest,
  ): Promise<Page<ApplicationNote>> {
    const filterKey = filterKeyFor({ notes: applicationId, userId });
    const offset = decodeCursor(page.cursor, filterKey);
    const { data, error } = await this.client
      .from("application_notes")
      .select("*")
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + page.limit);
    if (error) throw mapDatabaseError(error, "list notes");
    const rows = data ?? [];
    const hasMore = rows.length > page.limit;
    return {
      items: rows.slice(0, page.limit).map(mapNote),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + page.limit, filterKey) : null,
    };
  }

  async listActivity(
    userId: string,
    applicationId: string,
    page: PageRequest,
  ): Promise<Page<ApplicationActivity>> {
    const filterKey = filterKeyFor({ activity: applicationId, userId });
    const offset = decodeCursor(page.cursor, filterKey);
    const { data, error } = await this.client
      .from("application_activities")
      .select("*")
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + page.limit);
    if (error) throw mapDatabaseError(error, "list activity");
    const rows = data ?? [];
    const hasMore = rows.length > page.limit;
    return {
      items: rows.slice(0, page.limit).map(mapActivity),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + page.limit, filterKey) : null,
    };
  }

  async listStatuses(userId: string): Promise<ApplicationStatus[]> {
    const statuses: ApplicationStatus[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("applications")
        .select("status")
        .eq("user_id", userId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw mapDatabaseError(error, "count statuses");
      statuses.push(...(data ?? []).map((row) => row.status));
      if (!data || data.length < 500) return statuses;
    }
  }

  async listDuplicateIndex(userId: string): Promise<DuplicateIndexEntry[]> {
    const entries: DuplicateIndexEntry[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("application_overview")
        .select(
          "application_id, company_name, company_normalized_name, title, normalized_title, job_url, external_job_id, status",
        )
        .eq("user_id", userId)
        .order("application_id")
        .range(offset, offset + 499);
      if (error) throw mapDatabaseError(error, "duplicate index");
      entries.push(
        ...(data ?? []).map((row) => ({
          applicationId: row.application_id!,
          company: row.company_name!,
          normalizedCompany: row.company_normalized_name!,
          title: row.title!,
          normalizedTitle: row.normalized_title!,
          jobUrl: row.job_url,
          externalJobId: row.external_job_id,
          status: row.status!,
        })),
      );
      if (!data || data.length < 500) return entries;
    }
  }

  private async mutate(
    fn:
      | "create_application"
      | "update_application_status"
      | "update_application_details"
      | "add_application_note"
      | "update_application_note"
      | "delete_application",
    ctx: MutationContext,
    requestId: string,
    command: Record<string, unknown>,
  ): Promise<MutationResult> {
    const { data, error } = await this.client.rpc(fn, {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: requestId,
      p_command: stripUndefined(command) as Json,
      ...(ctx.today ? { p_today: ctx.today } : {}),
    });
    if (error) throw mapDatabaseError(error, fn, true);
    return asMutationResult(data, fn);
  }

  createApplication(
    ctx: MutationContext,
    command: CreateApplicationCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("create_application", ctx, requestId, rest);
  }

  deleteApplication(
    ctx: MutationContext,
    command: DeleteApplicationCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("delete_application", { ...ctx, today: null }, requestId, rest);
  }

  updateApplicationStatus(
    ctx: MutationContext,
    command: UpdateApplicationStatusCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("update_application_status", ctx, requestId, rest);
  }

  updateApplicationDetails(
    ctx: MutationContext,
    command: UpdateApplicationDetailsCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("update_application_details", ctx, requestId, rest);
  }

  addApplicationNote(
    ctx: MutationContext,
    command: AddApplicationNoteCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("add_application_note", ctx, requestId, rest);
  }

  updateApplicationNote(
    ctx: MutationContext,
    command: UpdateApplicationNoteCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("update_application_note", ctx, requestId, rest);
  }

  async importApplications(
    ctx: MutationContext,
    command: CommitImportCommand,
  ): Promise<MutationResult> {
    const { data, error } = await this.client.rpc("import_applications", {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: command.requestId,
      p_command: { rows: command.rows.map((row) => stripUndefined(row)) } as Json,
    });
    if (error) throw mapDatabaseError(error, "import_applications", true);
    return asMutationResult(data, "import_applications");
  }

  async getCandidateProfile(userId: string): Promise<CandidateProfile | null> {
    const { data, error } = await this.client
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get profile");
    return data ? mapProfile(data) : null;
  }

  async saveCandidateProfile(
    userId: string,
    command: CandidateProfileCommand,
  ): Promise<CandidateProfile> {
    const { error } = await this.client.rpc("save_candidate_profile", {
      p_owner_id: userId,
      p_command: stripUndefined(command) as Json,
    });
    if (error) throw mapDatabaseError(error, "save_candidate_profile", true);
    const profile = await this.getCandidateProfile(userId);
    if (!profile)
      throw new JwordError("INTERNAL_ERROR", "Profile was saved but could not be read back.");
    return profile;
  }
  // ------------------------------------------------------------ watchlist
  async listWatches(userId: string, query: WatchListQuery): Promise<Page<WatchedCompany>> {
    const { cursor, limit, ...filters } = query;
    const filterKey = filterKeyFor({ ...filters, userId, watches: true });
    const offset = decodeCursor(cursor, filterKey);
    let request = this.client.from("company_watch_overview").select("*").eq("user_id", userId);
    const text = query.text ? sanitizeSearchText(query.text) : "";
    if (text) request = request.ilike("company_name", `%${text}%`);
    if (query.active !== undefined) request = request.eq("active", query.active);
    if (query.provider) request = request.contains("board_providers", [query.provider]);
    const { data, error } = await request
      .order("company_name", { ascending: true })
      .order("watch_id", { ascending: true })
      .range(offset, offset + limit);
    if (error) throw mapDatabaseError(error, "list watched companies");
    const rows = (data ?? []) as WatchRow[];
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map(mapWatch),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + limit, filterKey) : null,
    };
  }

  async getWatch(userId: string, watchId: string): Promise<WatchedCompany | null> {
    const { data, error } = await this.client
      .from("company_watch_overview")
      .select("*")
      .eq("user_id", userId)
      .eq("watch_id", watchId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get watched company");
    return data ? mapWatch(data as WatchRow) : null;
  }

  async listWatchActivity(
    userId: string,
    watchId: string,
    page: PageRequest,
  ): Promise<Page<WatchActivity>> {
    const filterKey = filterKeyFor({ watchActivity: watchId, userId });
    const offset = decodeCursor(page.cursor, filterKey);
    const { data, error } = await this.client
      .from("company_watch_activities")
      .select("*")
      .eq("user_id", userId)
      .eq("original_watch_id", watchId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + page.limit);
    if (error) throw mapDatabaseError(error, "list watch activity");
    const rows = data ?? [];
    const hasMore = rows.length > page.limit;
    return {
      items: rows.slice(0, page.limit).map(mapWatchActivity),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + page.limit, filterKey) : null,
    };
  }

  async searchCompanies(userId: string, text: string, limit: number): Promise<CompanyOption[]> {
    const clean = sanitizeSearchText(text);
    if (!clean) return [];
    const { data, error } = await this.client
      .from("companies")
      .select("id, name")
      .eq("user_id", userId)
      .ilike("name", `%${clean}%`)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw mapDatabaseError(error, "search companies");
    const companies = data ?? [];
    if (!companies.length) return [];
    const { data: watches, error: watchError } = await this.client
      .from("company_watches")
      .select("id, company_id, active")
      .eq("user_id", userId)
      .in(
        "company_id",
        companies.map((c) => c.id),
      );
    if (watchError) throw mapDatabaseError(watchError, "search companies");
    const byCompany = new Map((watches ?? []).map((w) => [w.company_id, w]));
    return companies.map((c) => {
      const watch = byCompany.get(c.id);
      return {
        companyId: c.id,
        name: c.name,
        watchId: watch?.id ?? null,
        watchActive: watch ? watch.active : null,
      };
    });
  }

  private async mutateWatch(
    fn:
      | "create_company_watch"
      | "update_company_watch"
      | "set_company_watch_active"
      | "delete_company_watch",
    ctx: MutationContext,
    requestId: string,
    command: Record<string, unknown>,
  ): Promise<WatchMutationResult> {
    const { data, error } = await this.client.rpc(fn, {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: requestId,
      p_command: stripUndefined(command) as Json,
    });
    if (error) throw mapDatabaseError(error, fn, true);
    return asWatchResult(data, fn);
  }

  createWatch(
    ctx: MutationContext,
    command: AddWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const { requestId, ...rest } = command;
    return this.mutateWatch("create_company_watch", ctx, requestId, rest);
  }

  updateWatch(
    ctx: MutationContext,
    command: UpdateWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const { requestId, ...rest } = command;
    return this.mutateWatch("update_company_watch", ctx, requestId, rest);
  }

  deleteWatch(
    ctx: MutationContext,
    command: DeleteWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const { requestId, ...rest } = command;
    return this.mutateWatch("delete_company_watch", ctx, requestId, rest);
  }

  setWatchActive(
    ctx: MutationContext,
    command: SetCompanyWatchStatusCommand,
  ): Promise<WatchMutationResult> {
    const { requestId, ...rest } = command;
    return this.mutateWatch("set_company_watch_active", ctx, requestId, rest);
  }

  // ------------------------------------------------------- board discovery
  async getCompany(userId: string, companyId: string): Promise<CompanyRef | null> {
    const { data, error } = await this.client
      .from("companies")
      .select("id, name, website_url")
      .eq("user_id", userId)
      .eq("id", companyId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get company");
    return data ? { companyId: data.id, name: data.name, websiteUrl: data.website_url } : null;
  }

  async findCompanyByName(userId: string, name: string): Promise<CompanyRef | null> {
    const { data, error } = await this.client
      .from("companies")
      .select("id, name, website_url")
      .eq("user_id", userId)
      .eq("normalized_name", normalizeName(name))
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "find company");
    return data ? { companyId: data.id, name: data.name, websiteUrl: data.website_url } : null;
  }

  async listCompanyJobUrls(userId: string, companyId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("jobs")
      .select("job_url")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .not("job_url", "is", null)
      .limit(500);
    if (error) throw mapDatabaseError(error, "company job urls");
    return (data ?? []).map((row) => row.job_url!).filter(Boolean);
  }

  async listApplicationJobUrls(
    userId: string,
  ): Promise<Array<{ companyId: string; company: string; jobUrl: string }>> {
    const out: Array<{ companyId: string; company: string; jobUrl: string }> = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("application_overview")
        .select("application_id, company_id, company_name, job_url")
        .eq("user_id", userId)
        .not("job_url", "is", null)
        .order("application_id")
        .range(offset, offset + 499);
      if (error) throw mapDatabaseError(error, "application job urls");
      out.push(
        ...(data ?? []).map((row) => ({
          companyId: row.company_id!,
          company: row.company_name!,
          jobUrl: row.job_url!,
        })),
      );
      if (!data || data.length < 500) return out;
    }
  }

  async listWatchSummaries(userId: string): Promise<WatchSummary[]> {
    const out: WatchSummary[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("company_watch_overview")
        .select("watch_id, company_id, company_name, boards")
        .eq("user_id", userId)
        .order("watch_id")
        .range(offset, offset + 499);
      if (error) throw mapDatabaseError(error, "watch summaries");
      out.push(
        ...(data ?? []).map((row) => ({
          watchId: row.watch_id!,
          companyId: row.company_id!,
          company: row.company_name!,
          boards: (Array.isArray(row.boards) ? row.boards : []) as unknown as WatchBoard[],
        })),
      );
      if (!data || data.length < 500) return out;
    }
  }

  // ------------------------------------------------------------------ leads
  async beginLeadScan(
    ctx: MutationContext,
    board: { watchId: string; provider: SupportedBoardProvider; boardIdentifier: string },
  ): Promise<LeadScanStart> {
    const { data, error } = await this.client.rpc("begin_lead_scan", {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_command: board as unknown as Json,
    });
    if (error) throw mapDatabaseError(error, "begin_lead_scan");
    const raw = data as Record<string, unknown>;
    return { scanId: String(raw.scanId), sourceId: String(raw.sourceId) };
  }

  async recordLeadPostings(
    ctx: MutationContext,
    scanId: string,
    postings: EvaluatedPosting[],
  ): Promise<LeadPostingCounts> {
    const totals: LeadPostingCounts = {
      created: 0,
      updated: 0,
      relisted: 0,
      filtered: 0,
      filteredReasons: {},
    };
    for (let start = 0; start < postings.length; start += POSTING_CHUNK) {
      const { data, error } = await this.client.rpc("record_lead_postings", {
        p_owner_id: ctx.actor.userId,
        p_command: {
          scanId,
          postings: postings.slice(start, start + POSTING_CHUNK),
        } as unknown as Json,
      });
      if (error) throw mapDatabaseError(error, "record_lead_postings");
      const raw = data as Record<string, unknown>;
      totals.created += Number(raw.created ?? 0);
      totals.updated += Number(raw.updated ?? 0);
      totals.relisted += Number(raw.relisted ?? 0);
      totals.filtered += Number(raw.filtered ?? 0);
      for (const [reason, count] of Object.entries(
        (raw.filteredReasons ?? {}) as Record<string, number>,
      )) {
        totals.filteredReasons[reason] = (totals.filteredReasons[reason] ?? 0) + Number(count);
      }
    }
    return totals;
  }

  async finishLeadScan(
    ctx: MutationContext,
    scan: {
      scanId: string;
      status: "COMPLETE" | "PARTIAL" | "FAILED";
      reason: string | null;
      reportedTotal: number | null;
    },
  ): Promise<{ markedUnavailable: number }> {
    const { data, error } = await this.client.rpc("finish_lead_scan", {
      p_owner_id: ctx.actor.userId,
      p_command: scan as unknown as Json,
    });
    if (error) throw mapDatabaseError(error, "finish_lead_scan");
    return { markedUnavailable: Number((data as Record<string, unknown>).markedUnavailable ?? 0) };
  }

  async listLeads(userId: string, query: LeadListQuery): Promise<Page<Lead>> {
    const { cursor, limit, ...filters } = query;
    const filterKey = filterKeyFor({ ...filters, userId, leads: true });
    const offset = decodeCursor(cursor, filterKey);
    let request = this.client.from("lead_overview").select("*").eq("user_id", userId);
    const text = query.text ? sanitizeSearchText(query.text) : "";
    if (text)
      request = request.or(
        `title.ilike.%${text}%,company_name.ilike.%${text}%,location.ilike.%${text}%`,
      );
    if (query.companyId) request = request.eq("company_id", query.companyId);
    if (query.reviewStatus) request = request.eq("review_status", query.reviewStatus);
    if (query.availability) request = request.eq("availability", query.availability);
    if (query.match === "EXCLUDED") request = request.eq("match_status", "EXCLUDED");
    if (query.match === "NOT_EXCLUDED")
      request = request.or("match_status.is.null,match_status.neq.EXCLUDED");
    if (query.arrangement === "REMOTE") request = request.eq("arrangement", "REMOTE");
    if (query.arrangement === "NOT_REMOTE") request = request.neq("arrangement", "REMOTE");
    if (query.postedOnOrAfter)
      request = request.or(`posted_on.is.null,posted_on.gte.${query.postedOnOrAfter}`);
    if (query.role === "PREFERRED") request = request.eq("role_fit", "PREFERRED");
    if (query.role === "NOT_DEEMPHASIZED") request = request.neq("role_fit", "DEEMPHASIZED");
    if (query.sort === "CITY")
      request = request.order("city_rank", { ascending: true, nullsFirst: false });
    const { data, error } = await request
      .order("first_seen_at", { ascending: false })
      .order("lead_id", { ascending: true })
      .range(offset, offset + limit);
    if (error) throw mapDatabaseError(error, "list leads");
    const rows = (data ?? []) as LeadRow[];
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map(mapLead),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + limit, filterKey) : null,
    };
  }

  async getLead(userId: string, leadId: string): Promise<LeadDetail | null> {
    const { data, error } = await this.client
      .from("lead_overview")
      .select("*")
      .eq("user_id", userId)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get lead");
    if (!data) return null;
    const detail = await this.client
      .from("leads")
      .select("description")
      .eq("user_id", userId)
      .eq("id", leadId)
      .maybeSingle();
    if (detail.error) throw mapDatabaseError(detail.error, "get lead description");
    return { ...mapLead(data as LeadRow), description: detail.data?.description ?? null };
  }

  async listLeadCompanies(userId: string): Promise<LeadCompany[]> {
    const counts = new Map<string, LeadCompany>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client
        .from("lead_overview")
        .select("company_id, company_name")
        .eq("user_id", userId)
        .order("lead_id")
        .range(offset, offset + 999);
      if (error) throw mapDatabaseError(error, "lead companies");
      for (const row of data ?? []) {
        const entry = counts.get(row.company_id!) ?? {
          companyId: row.company_id!,
          company: row.company_name!,
          leadCount: 0,
        };
        entry.leadCount += 1;
        counts.set(entry.companyId, entry);
      }
      if (!data || data.length < 1000) break;
    }
    return [...counts.values()].sort((a, b) => a.company.localeCompare(b.company));
  }

  async setLeadReviewStatus(
    ctx: MutationContext,
    command: SetLeadReviewStatusCommand,
  ): Promise<LeadMutationResult> {
    const { requestId, ...rest } = command;
    const { data, error } = await this.client.rpc("set_lead_review_status", {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: requestId,
      p_command: stripUndefined(rest) as Json,
    });
    if (error) throw mapDatabaseError(error, "set_lead_review_status", true);
    return asLeadResult(data, "set_lead_review_status");
  }

  async createApplicationFromLead(
    ctx: MutationContext,
    command: CreateApplicationFromLeadCommand,
  ): Promise<LeadMutationResult> {
    const { requestId, ...rest } = command;
    const { data, error } = await this.client.rpc("create_application_from_lead", {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: requestId,
      p_command: stripUndefined(rest) as Json,
      ...(ctx.today ? { p_today: ctx.today } : {}),
    });
    if (error) throw mapDatabaseError(error, "create_application_from_lead", true);
    return asLeadResult(data, "create_application_from_lead");
  }

  // ------------------------------------------------------ search preferences
  async getSearchPreferences(userId: string): Promise<SearchPreferences | null> {
    const { data, error } = await this.client
      .from("search_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, "get search preferences");
    return data ? mapPreferences(data) : null;
  }

  async saveSearchPreferences(
    ctx: MutationContext,
    command: SaveSearchPreferencesCommand,
  ): Promise<PreferencesMutationResult> {
    const { requestId, ...rest } = command;
    const { data, error } = await this.client.rpc("save_search_preferences", {
      p_owner_id: ctx.actor.userId,
      p_actor: ctx.actor.actorType,
      p_request_id: requestId,
      p_command: stripUndefined(rest) as Json,
    });
    if (error) throw mapDatabaseError(error, "save_search_preferences", true);
    const raw = data as Record<string, unknown>;
    return {
      ok: true,
      operation: String(raw.operation ?? "save_search_preferences"),
      requestId: String(raw.requestId ?? requestId),
      replayed: raw.replayed === true,
      noop: raw.noop === true,
      version: Number(raw.version),
      activityId: typeof raw.activityId === "string" ? raw.activityId : null,
      summary: String(raw.summary ?? ""),
    };
  }

  async listLeadsToEvaluate(
    userId: string,
    query: { key: string; afterId?: string; limit: number },
  ): Promise<LeadEvaluationInput[]> {
    let request = this.client
      .from("leads")
      .select(
        "id, input_revision, title, location, locations, workplace_type, employment_type, description",
      )
      .eq("user_id", userId)
      .or(`evaluation_key.is.null,evaluation_key.neq.${query.key}`);
    if (query.afterId) request = request.gt("id", query.afterId);
    const { data, error } = await request.order("id", { ascending: true }).limit(query.limit);
    if (error) throw mapDatabaseError(error, "list leads to evaluate");
    return (data ?? []).map((row) => ({
      leadId: row.id,
      inputRevision: row.input_revision,
      title: row.title,
      location: row.location,
      locations: row.locations ?? [],
      workplaceType: (row.workplace_type as WorkplaceType | null) ?? null,
      employmentType: (row.employment_type as EmploymentType | null) ?? null,
      description: row.description,
    }));
  }

  async applyLeadEvaluations(
    ctx: MutationContext,
    preferencesVersion: number,
    evaluations: Array<{
      leadId: string;
      expectedInputRevision: number;
      evaluation: StoredLeadEvaluation;
    }>,
    graduationDate: string | null,
  ): Promise<{ updated: number }> {
    let updated = 0;
    for (let start = 0; start < evaluations.length; start += POSTING_CHUNK) {
      const { data, error } = await this.client.rpc("apply_lead_evaluations", {
        p_owner_id: ctx.actor.userId,
        p_command: {
          preferencesVersion,
          graduationDate,
          evaluations: evaluations.slice(start, start + POSTING_CHUNK),
        } as unknown as Json,
      });
      if (error) throw mapDatabaseError(error, "apply_lead_evaluations");
      updated += Number((data as Record<string, unknown>).updated ?? 0);
    }
    return { updated };
  }
}
