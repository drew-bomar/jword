import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../db/database.types";
import type { ApplicationStatus } from "../domain/enums";
import { JwordError } from "../domain/errors";
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
  UpdateApplicationDetailsCommand,
  UpdateApplicationNoteCommand,
  UpdateApplicationStatusCommand,
} from "../validation/schemas";
import { decodeCursor, encodeCursor, filterKeyFor } from "./cursor";
import { mapDatabaseError } from "./errors";
import type { MutationContext, PageRequest, TrackerRepository } from "./types";

export type JwordSupabaseClient = SupabaseClient<Database>;

type OverviewRow = Database["public"]["Views"]["application_overview"]["Row"];
type NoteRow = Database["public"]["Tables"]["application_notes"]["Row"];
type ActivityRow = Database["public"]["Tables"]["application_activities"]["Row"];
type ProfileRow = Database["public"]["Tables"]["candidate_profiles"]["Row"];

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
    noteDate: row.note_date,
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

/** PostgREST `or()` filter values: strip characters with syntax meaning and wildcards. */
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
export class SupabaseTrackerRepository implements TrackerRepository {
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
    const { data, error } = await this.client
      .from("applications")
      .select("status")
      .eq("user_id", userId);
    if (error) throw mapDatabaseError(error, "count statuses");
    return (data ?? []).map((row) => row.status);
  }

  async listDuplicateIndex(userId: string): Promise<DuplicateIndexEntry[]> {
    const { data, error } = await this.client
      .from("application_overview")
      .select(
        "application_id, company_name, company_normalized_name, title, normalized_title, job_url, external_job_id, status",
      )
      .eq("user_id", userId);
    if (error) throw mapDatabaseError(error, "duplicate index");
    return (data ?? []).map((row) => ({
      applicationId: row.application_id!,
      company: row.company_name!,
      normalizedCompany: row.company_normalized_name!,
      title: row.title!,
      normalizedTitle: row.normalized_title!,
      jobUrl: row.job_url,
      externalJobId: row.external_job_id,
      status: row.status!,
    }));
  }

  private async mutate(
    fn:
      | "create_application"
      | "update_application_status"
      | "update_application_details"
      | "add_application_note"
      | "update_application_note",
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
    if (error) throw mapDatabaseError(error, fn);
    return asMutationResult(data, fn);
  }

  createApplication(
    ctx: MutationContext,
    command: CreateApplicationCommand,
  ): Promise<MutationResult> {
    const { requestId, ...rest } = command;
    return this.mutate("create_application", ctx, requestId, rest);
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
    if (error) throw mapDatabaseError(error, "import_applications");
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
    if (error) throw mapDatabaseError(error, "save_candidate_profile");
    const profile = await this.getCandidateProfile(userId);
    if (!profile)
      throw new JwordError("INTERNAL_ERROR", "Profile was saved but could not be read back.");
    return profile;
  }
}
