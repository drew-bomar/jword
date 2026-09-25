import { randomUUID } from "node:crypto";
import { creationDates, statusAppliedDate } from "../domain/date-policy";
import type { ActivityType, ApplicationStatus } from "../domain/enums";
import { JwordError, type DuplicateCandidate } from "../domain/errors";
import { cleanText, normalizeName } from "../domain/normalize";
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
import { findDuplicateCandidates, type DuplicateIndexEntry } from "../import/validate";
import { decodeCursor, encodeCursor, filterKeyFor } from "../repositories/cursor";
import type {
  MutationContext,
  PageRequest,
  TrackerRepository,
  WatchlistRepository,
} from "../repositories/types";
import type {
  AddApplicationNoteCommand,
  CandidateProfileCommand,
  CommitImportCommand,
  CreateApplicationCommand,
  ImportRowCommand,
  UpdateApplicationDetailsCommand,
  UpdateApplicationNoteCommand,
  UpdateApplicationStatusCommand,
} from "../validation/schemas";
import { canonicalBoardUrl, isValidBoardIdentifier } from "../watchlist/boards";
import {
  boardKey,
  MAX_BOARDS_PER_WATCH,
  type AddWatchedCompanyCommand,
  type BoardInput,
  type DeleteWatchedCompanyCommand,
  type SetCompanyWatchStatusCommand,
  type UpdateWatchedCompanyCommand,
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

interface CompanyRecord {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  websiteUrl?: string | null;
  interestLevel?: number | null;
  notes?: string | null;
}

interface WatchRecord {
  id: string;
  userId: string;
  companyId: string;
  active: boolean;
  boards: WatchBoard[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface WatchActivityRecord extends WatchActivity {
  userId: string;
}

interface JobRecord {
  id: string;
  userId: string;
  companyId: string;
  title: string;
  normalizedTitle: string;
  jobUrl: string | null;
  externalJobId: string | null;
  location: string | null;
  workArrangement: ApplicationOverview["workArrangement"];
  description: string | null;
  datePosted: string | null;
  source: string | null;
  updatedAt: string;
}

interface ApplicationRecord {
  id: string;
  userId: string;
  jobId: string;
  version: number;
  status: ApplicationStatus;
  priority: ApplicationOverview["priority"];
  dateFound: string | null;
  appliedAt: string | null;
  lastActivityAt: string;
  resumeVersion: string | null;
  referral: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NoteRecord extends ApplicationNote {
  userId: string;
}

interface ActivityRecord extends ApplicationActivity {
  userId: string;
}

interface Receipt {
  operation: string;
  fingerprint: string;
  result: MutationResult | WatchMutationResult;
}

const PRIORITY_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

/**
 * In-memory repository that mirrors the SQL function semantics (ownership, versions,
 * receipts, duplicate candidates, no-ops, atomic activity). Used by unit tests and the
 * scripted MCP scenarios so business behavior can be exercised without a database.
 */
export class FakeTrackerRepository implements TrackerRepository, WatchlistRepository {
  companies: CompanyRecord[] = [];
  jobs: JobRecord[] = [];
  applications: ApplicationRecord[] = [];
  notes: NoteRecord[] = [];
  activities: ActivityRecord[] = [];
  receipts = new Map<string, Receipt>();
  profiles = new Map<string, CandidateProfile>();
  watches: WatchRecord[] = [];
  watchActivities: WatchActivityRecord[] = [];
  /** Test hook: throw inside the "transaction" after the primary write to prove rollback. */
  failBeforeActivity = false;
  private clockMs = Date.parse("2026-09-21T15:00:00Z");

  private now(): string {
    this.clockMs += 1000;
    return new Date(this.clockMs).toISOString();
  }

  // ------------------------------------------------------------------ reads
  private overview(app: ApplicationRecord): ApplicationDetail {
    const job = this.jobs.find((j) => j.id === app.jobId && j.userId === app.userId)!;
    const company = this.companies.find((c) => c.id === job.companyId && c.userId === app.userId)!;
    return {
      applicationId: app.id,
      jobId: job.id,
      companyId: company.id,
      company: company.name,
      title: job.title,
      status: app.status,
      priority: app.priority,
      version: app.version,
      location: job.location,
      workArrangement: job.workArrangement,
      jobUrl: job.jobUrl,
      externalJobId: job.externalJobId,
      source: job.source,
      dateFound: app.dateFound,
      appliedAt: app.appliedAt,
      datePosted: job.datePosted,
      resumeVersion: app.resumeVersion,
      referral: app.referral,
      lastActivityAt: app.lastActivityAt,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt > job.updatedAt ? app.updatedAt : job.updatedAt,
      description: job.description,
    };
  }

  async searchApplications(
    userId: string,
    query: Required<Pick<SearchQuery, "limit">> & SearchQuery,
  ): Promise<Page<ApplicationOverview>> {
    const { cursor, limit, ...filters } = query;
    const filterKey = filterKeyFor({ ...filters, userId });
    const offset = decodeCursor(cursor, filterKey);
    const text = query.text?.trim().toLowerCase();
    let rows = this.applications.filter((a) => a.userId === userId).map((a) => this.overview(a));
    if (text)
      rows = rows.filter(
        (r) => r.company.toLowerCase().includes(text) || r.title.toLowerCase().includes(text),
      );
    if (query.statuses?.length) rows = rows.filter((r) => query.statuses!.includes(r.status));
    if (query.priorities?.length) rows = rows.filter((r) => query.priorities!.includes(r.priority));
    if (query.appliedFrom)
      rows = rows.filter((r) => r.appliedAt !== null && r.appliedAt >= query.appliedFrom!);
    if (query.appliedTo)
      rows = rows.filter((r) => r.appliedAt !== null && r.appliedAt <= query.appliedTo!);
    if (query.updatedBefore) rows = rows.filter((r) => r.lastActivityAt < query.updatedBefore!);
    const sort = query.sort ?? "updated";
    const dir = (query.direction ?? (sort === "company" ? "asc" : "desc")) === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (sort === "updated") cmp = a.lastActivityAt.localeCompare(b.lastActivityAt);
      else if (sort === "company")
        cmp = a.company.localeCompare(b.company) || a.title.localeCompare(b.title);
      else if (sort === "priority") cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (sort === "applied") {
        if (a.appliedAt === null && b.appliedAt === null) cmp = 0;
        else if (a.appliedAt === null) return 1;
        else if (b.appliedAt === null) return -1;
        else cmp = a.appliedAt.localeCompare(b.appliedAt);
      }
      return cmp * dir || a.applicationId.localeCompare(b.applicationId);
    });
    const slice = rows.slice(offset, offset + limit + 1);
    const hasMore = slice.length > limit;
    return {
      items: slice.slice(0, limit).map(({ description: _d, ...rest }) => rest),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + limit, filterKey) : null,
    };
  }

  async getApplication(userId: string, applicationId: string): Promise<ApplicationDetail | null> {
    const app = this.applications.find((a) => a.userId === userId && a.id === applicationId);
    return app ? this.overview(app) : null;
  }

  async listNotes(
    userId: string,
    applicationId: string,
    page: PageRequest,
  ): Promise<Page<ApplicationNote>> {
    const filterKey = filterKeyFor({ notes: applicationId, userId });
    const offset = decodeCursor(page.cursor, filterKey);
    const rows = this.notes
      .filter((n) => n.userId === userId && n.applicationId === applicationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.noteId.localeCompare(b.noteId));
    const slice = rows.slice(offset, offset + page.limit + 1);
    const hasMore = slice.length > page.limit;
    return {
      items: slice.slice(0, page.limit).map(({ userId: _u, ...n }) => n),
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
    const rows = this.activities
      .filter((a) => a.userId === userId && a.applicationId === applicationId)
      .sort(
        (a, b) =>
          b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt),
      );
    const slice = rows.slice(offset, offset + page.limit + 1);
    const hasMore = slice.length > page.limit;
    return {
      items: slice.slice(0, page.limit).map(({ userId: _u, ...a }) => a),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + page.limit, filterKey) : null,
    };
  }

  async listStatuses(userId: string): Promise<ApplicationStatus[]> {
    return this.applications.filter((a) => a.userId === userId).map((a) => a.status);
  }

  async listDuplicateIndex(userId: string): Promise<DuplicateIndexEntry[]> {
    return this.applications
      .filter((a) => a.userId === userId)
      .map((a) => {
        const o = this.overview(a);
        return {
          applicationId: o.applicationId,
          company: o.company,
          normalizedCompany: normalizeName(o.company),
          title: o.title,
          normalizedTitle: normalizeName(o.title),
          jobUrl: o.jobUrl,
          externalJobId: o.externalJobId,
          status: o.status,
        };
      });
  }

  // ------------------------------------------------------------- internals
  private fingerprint(
    operation: string,
    ctx: MutationContext,
    command: Record<string, unknown>,
  ): string {
    const { requestId: _r, ...rest } = command;
    return `${operation}|${ctx.actor.actorType}|${JSON.stringify(rest, Object.keys(rest).sort())}`;
  }

  private beginRequest(
    ctx: MutationContext,
    requestId: string,
    operation: string,
    fp: string,
  ): MutationResult | null {
    const key = `${ctx.actor.userId}:${requestId}`;
    const receipt = this.receipts.get(key);
    if (!receipt) return null;
    if (receipt.operation !== operation || receipt.fingerprint !== fp) {
      throw new JwordError(
        "CONFLICT",
        "This request id was already used for a different command.",
        {
          reason: "REQUEST_ID_REUSED",
        },
      );
    }
    return { ...(receipt.result as MutationResult), replayed: true };
  }

  private finishRequest(
    ctx: MutationContext,
    requestId: string,
    operation: string,
    fp: string,
    result: MutationResult,
  ): MutationResult {
    this.receipts.set(`${ctx.actor.userId}:${requestId}`, { operation, fingerprint: fp, result });
    return { ...result, replayed: false };
  }

  private lockApplication(
    userId: string,
    applicationId: string,
    expectedVersion: number,
  ): ApplicationRecord {
    const app = this.applications.find((a) => a.userId === userId && a.id === applicationId);
    if (!app)
      throw new JwordError("NOT_FOUND", "Application not found.", {
        reason: "APPLICATION_NOT_FOUND",
      });
    if (app.version !== expectedVersion) {
      throw new JwordError(
        "CONFLICT",
        "This application changed since you opened it. Refresh before saving.",
        {
          reason: "STALE_VERSION",
          currentVersion: app.version,
          expectedVersion,
        },
      );
    }
    return app;
  }

  private resolveCompany(
    userId: string,
    name: string | null | undefined,
    companyId?: string,
  ): CompanyRecord {
    if (companyId) {
      const existing = this.companies.find((c) => c.userId === userId && c.id === companyId);
      if (!existing)
        throw new JwordError("NOT_FOUND", "Selected company was not found.", {
          reason: "COMPANY_NOT_FOUND",
        });
      return existing;
    }
    const clean = cleanText(name);
    if (!clean)
      throw new JwordError("VALIDATION_ERROR", "Company name is required.", {
        reason: "COMPANY_REQUIRED",
      });
    const normalized = normalizeName(clean);
    const existing = this.companies.find(
      (c) => c.userId === userId && c.normalizedName === normalized,
    );
    if (existing) return existing;
    const record = { id: randomUUID(), userId, name: clean, normalizedName: normalized };
    this.companies.push(record);
    return record;
  }

  private addActivity(
    userId: string,
    applicationId: string,
    type: ActivityType,
    actorType: ActivityRecord["actorType"],
    summary: string,
    metadata: Record<string, unknown>,
    occurredAt?: string,
  ): ActivityRecord {
    if (this.failBeforeActivity)
      throw new JwordError("INTERNAL_ERROR", "Injected activity failure; transaction rolled back.");
    const ts = this.now();
    const record: ActivityRecord = {
      activityId: randomUUID(),
      userId,
      applicationId,
      type,
      actorType,
      summary,
      metadata,
      occurredAt: occurredAt ?? ts,
      createdAt: ts,
    };
    this.activities.push(record);
    return record;
  }

  /** Run a mutation "transactionally": snapshot state, roll back on throw. */
  private transaction<T>(fn: () => T): T {
    const snapshot = {
      companies: structuredClone(this.companies),
      jobs: structuredClone(this.jobs),
      applications: structuredClone(this.applications),
      notes: structuredClone(this.notes),
      activities: structuredClone(this.activities),
      watches: structuredClone(this.watches),
      watchActivities: structuredClone(this.watchActivities),
      receipts: new Map(this.receipts),
    };
    try {
      return fn();
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  private createTracked(
    ctx: MutationContext,
    command:
      | Omit<CreateApplicationCommand, "requestId">
      | (ImportRowCommand & { allowDuplicate?: boolean; initialNote?: string | null }),
    activityType: "CREATED" | "IMPORTED",
    metadata: Record<string, unknown>,
  ) {
    const userId = ctx.actor.userId;
    const title = cleanText(command.title);
    if (!title)
      throw new JwordError("VALIDATION_ERROR", "Job title is required.", {
        reason: "TITLE_REQUIRED",
      });
    const company = this.resolveCompany(
      userId,
      command.company,
      "companyId" in command ? command.companyId : undefined,
    );
    const jobUrl = cleanText(command.jobUrl) ?? null;
    const externalJobId = cleanText(command.externalJobId) ?? null;
    if (!command.allowDuplicate) {
      const candidates: DuplicateCandidate[] = findDuplicateCandidates(
        {
          normalizedCompany: company.normalizedName,
          normalizedTitle: normalizeName(title),
          jobUrl,
          externalJobId,
        },
        // synchronous version of listDuplicateIndex
        this.applications
          .filter((a) => a.userId === userId)
          .map((a) => {
            const o = this.overview(a);
            return {
              applicationId: o.applicationId,
              company: o.company,
              normalizedCompany: normalizeName(o.company),
              title: o.title,
              normalizedTitle: normalizeName(o.title),
              jobUrl: o.jobUrl,
              externalJobId: o.externalJobId,
              status: o.status,
            };
          }),
      );
      if (candidates.length) {
        throw new JwordError(
          "CONFLICT",
          "A similar application already exists. Confirm to create a separate application.",
          {
            reason: "DUPLICATE_CANDIDATES",
            candidates,
          },
        );
      }
    }
    const status = command.status ?? "SAVED";
    const { dateFound, appliedAt } = creationDates(command, ctx.today);
    const ts = this.now();
    const job: JobRecord = {
      id: randomUUID(),
      userId,
      companyId: company.id,
      title,
      normalizedTitle: normalizeName(title),
      jobUrl,
      externalJobId,
      location: cleanText(command.location) ?? null,
      workArrangement: command.workArrangement ?? "UNKNOWN",
      description: "description" in command ? (cleanText(command.description) ?? null) : null,
      datePosted: command.datePosted ?? null,
      source: cleanText(command.source) ?? null,
      updatedAt: ts,
    };
    this.jobs.push(job);
    const app: ApplicationRecord = {
      id: randomUUID(),
      userId,
      jobId: job.id,
      version: 1,
      status,
      priority: command.priority ?? "MEDIUM",
      dateFound: dateFound ?? null,
      appliedAt: appliedAt ?? null,
      lastActivityAt: ts,
      resumeVersion: cleanText(command.resumeVersion) ?? null,
      referral: cleanText(command.referral) ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.applications.push(app);
    let noteId: string | null = null;
    const noteBody =
      "initialNote" in command ? command.initialNote : "note" in command ? command.note : null;
    if (noteBody && noteBody.trim()) {
      noteId = randomUUID();
      this.notes.push({
        noteId,
        userId,
        applicationId: app.id,
        body: noteBody,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    const activity = this.addActivity(
      userId,
      app.id,
      activityType,
      ctx.actor.actorType,
      activityType === "IMPORTED" ? "Imported from CSV" : "Application created",
      { ...metadata, status, priority: app.priority, noteId },
    );
    return { app, job, company, noteId, activity };
  }

  // ------------------------------------------------------------- mutations
  async createApplication(
    ctx: MutationContext,
    command: CreateApplicationCommand,
  ): Promise<MutationResult> {
    const op = "create_application";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const { requestId, ...rest } = command;
      const { app, job, company, noteId, activity } = this.createTracked(ctx, rest, "CREATED", {});
      return this.finishRequest(ctx, requestId, op, fp, {
        ok: true,
        operation: op,
        requestId,
        replayed: false,
        noop: false,
        applicationId: app.id,
        jobId: job.id,
        companyId: company.id,
        noteId,
        activityId: activity.activityId,
        version: 1,
        summary: `Created ${app.status} application at ${company.name}`,
        changedFields: ["status", "priority", "dateFound", "appliedAt"],
        before: {},
        after: {
          status: app.status,
          priority: app.priority,
          dateFound: app.dateFound,
          appliedAt: app.appliedAt,
        },
      });
    });
  }

  async updateApplicationStatus(
    ctx: MutationContext,
    command: UpdateApplicationStatusCommand,
  ): Promise<MutationResult> {
    const op = "update_application_status";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const app = this.lockApplication(
        ctx.actor.userId,
        command.applicationId,
        command.expectedVersion,
      );
      const statusChanged = command.status !== app.status;
      const newApplied = statusAppliedDate(command, app, ctx.today);
      const appliedChanged = newApplied !== app.appliedAt;
      if (!statusChanged && !appliedChanged) {
        return this.finishRequest(ctx, command.requestId, op, fp, {
          ok: true,
          operation: op,
          requestId: command.requestId,
          replayed: false,
          noop: true,
          applicationId: app.id,
          version: app.version,
          summary: `Status is already ${app.status}; nothing changed.`,
          changedFields: [],
          before: {},
          after: {},
        });
      }
      const changed: string[] = [];
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      if (statusChanged) {
        changed.push("status");
        before.status = app.status;
        after.status = command.status;
      }
      if (appliedChanged) {
        changed.push("appliedAt");
        before.appliedAt = app.appliedAt;
        after.appliedAt = newApplied;
      }
      const ts = this.now();
      app.status = command.status;
      app.appliedAt = newApplied;
      app.version += 1;
      app.lastActivityAt = ts;
      app.updatedAt = ts;
      const summary = statusChanged
        ? `Status changed from ${before.status} to ${after.status}`
        : "Applied date updated";
      const activity = this.addActivity(
        ctx.actor.userId,
        app.id,
        statusChanged ? "STATUS_CHANGED" : "DETAILS_UPDATED",
        ctx.actor.actorType,
        summary,
        { fields: changed, before, after },
        command.occurredAt,
      );
      return this.finishRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        applicationId: app.id,
        version: app.version,
        activityId: activity.activityId,
        summary,
        changedFields: changed,
        before,
        after,
      });
    });
  }

  async updateApplicationDetails(
    ctx: MutationContext,
    command: UpdateApplicationDetailsCommand,
  ): Promise<MutationResult> {
    const op = "update_application_details";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const userId = ctx.actor.userId;
      const app = this.lockApplication(userId, command.applicationId, command.expectedVersion);
      const job = this.jobs.find((j) => j.id === app.jobId && j.userId === userId)!;
      const changed: string[] = [];
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      const track = (field: string, oldValue: string | null, newValue: string | null) => {
        if (oldValue !== newValue) {
          changed.push(field);
          before[field] = oldValue;
          after[field] = newValue;
          return true;
        }
        return false;
      };
      const appPatch: Partial<ApplicationRecord> = {};
      const jobPatch: Partial<JobRecord> = {};
      if (command.priority !== undefined && track("priority", app.priority, command.priority))
        appPatch.priority = command.priority;
      if (command.appliedAt !== undefined && track("appliedAt", app.appliedAt, command.appliedAt))
        appPatch.appliedAt = command.appliedAt;
      if (command.dateFound !== undefined && track("dateFound", app.dateFound, command.dateFound))
        appPatch.dateFound = command.dateFound;
      if (
        command.resumeVersion !== undefined &&
        track("resumeVersion", app.resumeVersion, command.resumeVersion)
      )
        appPatch.resumeVersion = command.resumeVersion;
      if (command.referral !== undefined && track("referral", app.referral, command.referral))
        appPatch.referral = command.referral;
      if (command.title !== undefined && track("title", job.title, command.title)) {
        jobPatch.title = command.title;
        jobPatch.normalizedTitle = normalizeName(command.title);
      }
      if (command.jobUrl !== undefined && track("jobUrl", job.jobUrl, command.jobUrl))
        jobPatch.jobUrl = command.jobUrl;
      if (
        command.externalJobId !== undefined &&
        track("externalJobId", job.externalJobId, command.externalJobId)
      )
        jobPatch.externalJobId = command.externalJobId;
      if (command.location !== undefined && track("location", job.location, command.location))
        jobPatch.location = command.location;
      if (
        command.workArrangement !== undefined &&
        track("workArrangement", job.workArrangement, command.workArrangement)
      )
        jobPatch.workArrangement = command.workArrangement;
      if (command.source !== undefined && track("source", job.source, command.source))
        jobPatch.source = command.source;
      if (
        command.datePosted !== undefined &&
        track("datePosted", job.datePosted, command.datePosted)
      )
        jobPatch.datePosted = command.datePosted;
      if (command.description !== undefined && job.description !== command.description) {
        changed.push("description");
        jobPatch.description = command.description;
      }
      if (command.company !== undefined || command.companyId !== undefined) {
        const company = this.resolveCompany(userId, command.company, command.companyId);
        if (company.id !== job.companyId) {
          const oldCompany = this.companies.find((c) => c.id === job.companyId)!;
          track("company", oldCompany.name, company.name);
          jobPatch.companyId = company.id;
        }
      }
      if (changed.length === 0) {
        return this.finishRequest(ctx, command.requestId, op, fp, {
          ok: true,
          operation: op,
          requestId: command.requestId,
          replayed: false,
          noop: true,
          applicationId: app.id,
          version: app.version,
          summary: "No changes were needed.",
          changedFields: [],
          before: {},
          after: {},
        });
      }
      const ts = this.now();
      Object.assign(job, jobPatch, { updatedAt: ts });
      Object.assign(app, appPatch, { version: app.version + 1, lastActivityAt: ts, updatedAt: ts });
      const summary = `Updated ${changed.join(", ")}`;
      const activity = this.addActivity(
        userId,
        app.id,
        "DETAILS_UPDATED",
        ctx.actor.actorType,
        summary,
        { fields: changed, before, after },
      );
      return this.finishRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        applicationId: app.id,
        version: app.version,
        activityId: activity.activityId,
        summary,
        changedFields: changed,
        before,
        after,
      });
    });
  }

  async addApplicationNote(
    ctx: MutationContext,
    command: AddApplicationNoteCommand,
  ): Promise<MutationResult> {
    const op = "add_application_note";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const app = this.lockApplication(
        ctx.actor.userId,
        command.applicationId,
        command.expectedVersion,
      );
      const ts = this.now();
      const noteId = randomUUID();
      this.notes.push({
        noteId,
        userId: ctx.actor.userId,
        applicationId: app.id,
        body: command.note,
        createdAt: ts,
        updatedAt: ts,
      });
      app.version += 1;
      app.lastActivityAt = ts;
      app.updatedAt = ts;
      const activity = this.addActivity(
        ctx.actor.userId,
        app.id,
        "NOTE_ADDED",
        ctx.actor.actorType,
        "Added a note",
        {
          noteId,
        },
      );
      return this.finishRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        applicationId: app.id,
        noteId,
        version: app.version,
        activityId: activity.activityId,
        summary: "Note added",
        changedFields: ["note"],
        before: {},
        after: {},
      });
    });
  }

  async updateApplicationNote(
    ctx: MutationContext,
    command: UpdateApplicationNoteCommand,
  ): Promise<MutationResult> {
    const op = "update_application_note";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const app = this.lockApplication(
        ctx.actor.userId,
        command.applicationId,
        command.expectedVersion,
      );
      const note = this.notes.find(
        (n) =>
          n.userId === ctx.actor.userId &&
          n.noteId === command.noteId &&
          n.applicationId === app.id,
      );
      if (!note)
        throw new JwordError("NOT_FOUND", "Note not found on this application.", {
          reason: "NOTE_NOT_FOUND",
        });
      if (command.note === note.body) {
        return this.finishRequest(ctx, command.requestId, op, fp, {
          ok: true,
          operation: op,
          requestId: command.requestId,
          replayed: false,
          noop: true,
          applicationId: app.id,
          noteId: note.noteId,
          version: app.version,
          summary: "Note is already up to date.",
          changedFields: [],
          before: {},
          after: {},
        });
      }
      const ts = this.now();
      const metadata = {
        noteId: note.noteId,
        fields: ["note"],
        before: { note: note.body },
        after: { note: command.note },
      };
      note.body = command.note;
      note.updatedAt = ts;
      app.version += 1;
      app.lastActivityAt = ts;
      app.updatedAt = ts;
      const activity = this.addActivity(
        ctx.actor.userId,
        app.id,
        "NOTE_UPDATED",
        ctx.actor.actorType,
        "Updated a note",
        metadata,
      );
      return this.finishRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        applicationId: app.id,
        noteId: note.noteId,
        version: app.version,
        activityId: activity.activityId,
        summary: "Note updated",
        changedFields: ["note"],
        before: {},
        after: {},
      });
    });
  }

  async importApplications(
    ctx: MutationContext,
    command: CommitImportCommand,
  ): Promise<MutationResult> {
    const op = "import_applications";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const ids: string[] = [];
      for (const row of command.rows) {
        try {
          const { duplicateChoice, rowIndex, ...rest } = row;
          const { app } = this.createTracked(
            { actor: ctx.actor, today: null },
            {
              ...rest,
              rowIndex,
              dateFound: row.dateFound ?? null,
              appliedAt: row.appliedAt ?? null,
              allowDuplicate: duplicateChoice === "import_separate",
            },
            "IMPORTED",
            { rowIndex },
          );
          ids.push(app.id);
        } catch (error) {
          if (error instanceof JwordError && error.code === "CONFLICT") {
            throw new JwordError(
              "IMPORT_ROW_ERROR",
              `Row ${row.rowIndex} matches an existing application and has no duplicate choice.`,
              { reason: "DUPLICATE_UNRESOLVED", rowIndex: row.rowIndex },
            );
          }
          if (
            error instanceof JwordError &&
            (error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND")
          ) {
            throw new JwordError("IMPORT_ROW_ERROR", `Row ${row.rowIndex}: ${error.message}`, {
              reason: "ROW_INVALID",
              rowIndex: row.rowIndex,
            });
          }
          throw error;
        }
      }
      return this.finishRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        imported: ids.length,
        applicationIds: ids,
        summary: `Imported ${ids.length} application(s)`,
        changedFields: [],
        before: {},
        after: {},
      });
    });
  }

  // --------------------------------------------------------------- profile
  async getCandidateProfile(userId: string): Promise<CandidateProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async saveCandidateProfile(
    userId: string,
    command: CandidateProfileCommand,
  ): Promise<CandidateProfile> {
    const profile: CandidateProfile = {
      userId,
      fullName: command.fullName ?? null,
      email: command.email ?? null,
      phone: command.phone ?? null,
      location: command.location ?? null,
      linkedinUrl: command.linkedinUrl ?? null,
      githubUrl: command.githubUrl ?? null,
      portfolioUrl: command.portfolioUrl ?? null,
      school: command.school ?? null,
      degree: command.degree ?? null,
      graduationDate: command.graduationDate ?? null,
      workAuthorization: command.workAuthorization ?? null,
      requiresSponsorship: command.requiresSponsorship ?? null,
      updatedAt: this.now(),
    };
    this.profiles.set(userId, profile);
    return profile;
  }
  // -------------------------------------------------------------- watchlist
  private watchView(watch: WatchRecord): WatchedCompany {
    const company = this.companies.find(
      (c) => c.id === watch.companyId && c.userId === watch.userId,
    )!;
    const last = this.watchActivities
      .filter((a) => a.userId === watch.userId && a.watchId === watch.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const applicationCount = this.applications.filter((a) => {
      const job = this.jobs.find((j) => j.id === a.jobId && j.userId === a.userId);
      return a.userId === watch.userId && job?.companyId === watch.companyId;
    }).length;
    return {
      watchId: watch.id,
      companyId: company.id,
      company: company.name,
      boards: structuredClone(watch.boards),
      active: watch.active,
      version: watch.version,
      interestLevel: company.interestLevel ?? null,
      websiteUrl: company.websiteUrl ?? null,
      companyNotes: company.notes ?? null,
      applicationCount,
      lastEvent: last
        ? {
            type: last.type,
            actorType: last.actorType,
            summary: last.summary,
            occurredAt: last.occurredAt,
          }
        : null,
      createdAt: watch.createdAt,
      updatedAt: watch.updatedAt,
    };
  }

  async listWatches(userId: string, query: WatchListQuery): Promise<Page<WatchedCompany>> {
    const { cursor, limit, ...filters } = query;
    const filterKey = filterKeyFor({ ...filters, userId, watches: true });
    const offset = decodeCursor(cursor, filterKey);
    const text = query.text?.trim().toLowerCase();
    const rows = this.watches
      .filter((w) => w.userId === userId)
      .map((w) => this.watchView(w))
      .filter((w) => !text || w.company.toLowerCase().includes(text))
      .filter((w) => query.active === undefined || w.active === query.active)
      .filter((w) => !query.provider || w.boards.some((b) => b.provider === query.provider))
      .sort((a, b) => a.company.localeCompare(b.company) || a.watchId.localeCompare(b.watchId));
    const slice = rows.slice(offset, offset + limit + 1);
    const hasMore = slice.length > limit;
    return {
      items: slice.slice(0, limit),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + limit, filterKey) : null,
    };
  }

  async getWatch(userId: string, watchId: string): Promise<WatchedCompany | null> {
    const watch = this.watches.find((w) => w.userId === userId && w.id === watchId);
    return watch ? this.watchView(watch) : null;
  }

  async listWatchActivity(
    userId: string,
    watchId: string,
    page: PageRequest,
  ): Promise<Page<WatchActivity>> {
    const filterKey = filterKeyFor({ watchActivity: watchId, userId });
    const offset = decodeCursor(page.cursor, filterKey);
    const rows = this.watchActivities
      .filter((a) => a.userId === userId && a.watchId === watchId)
      .sort(
        (a, b) =>
          b.occurredAt.localeCompare(a.occurredAt) || a.activityId.localeCompare(b.activityId),
      );
    const slice = rows.slice(offset, offset + page.limit + 1);
    const hasMore = slice.length > page.limit;
    return {
      items: slice.slice(0, page.limit).map(({ userId: _u, ...a }) => a),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + page.limit, filterKey) : null,
    };
  }

  async searchCompanies(userId: string, text: string, limit: number): Promise<CompanyOption[]> {
    const needle = text.trim().toLowerCase();
    return this.companies
      .filter((c) => c.userId === userId && c.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((c) => {
        const watch = this.watches.find((w) => w.userId === userId && w.companyId === c.id);
        return {
          companyId: c.id,
          name: c.name,
          watchId: watch?.id ?? null,
          watchActive: watch ? watch.active : null,
        };
      });
  }

  async getCompany(userId: string, companyId: string): Promise<CompanyRef | null> {
    const c = this.companies.find((x) => x.userId === userId && x.id === companyId);
    return c ? { companyId: c.id, name: c.name, websiteUrl: c.websiteUrl ?? null } : null;
  }

  async findCompanyByName(userId: string, name: string): Promise<CompanyRef | null> {
    const c = this.companies.find(
      (x) => x.userId === userId && x.normalizedName === normalizeName(name),
    );
    return c ? { companyId: c.id, name: c.name, websiteUrl: c.websiteUrl ?? null } : null;
  }

  async listCompanyJobUrls(userId: string, companyId: string): Promise<string[]> {
    return this.jobs
      .filter((j) => j.userId === userId && j.companyId === companyId && j.jobUrl)
      .map((j) => j.jobUrl!);
  }

  async listApplicationJobUrls(
    userId: string,
  ): Promise<Array<{ companyId: string; company: string; jobUrl: string }>> {
    return this.applications
      .filter((a) => a.userId === userId)
      .map((a) => this.overview(a))
      .filter((o) => o.jobUrl)
      .map((o) => ({ companyId: o.companyId, company: o.company, jobUrl: o.jobUrl! }));
  }

  async listWatchSummaries(userId: string): Promise<WatchSummary[]> {
    return this.watches
      .filter((w) => w.userId === userId)
      .map((w) => ({
        watchId: w.id,
        companyId: w.companyId,
        company: this.companies.find((c) => c.id === w.companyId)!.name,
        boards: structuredClone(w.boards),
      }));
  }

  private beginWatchRequest(
    ctx: MutationContext,
    requestId: string,
    operation: string,
    fp: string,
  ): WatchMutationResult | null {
    const receipt = this.receipts.get(`${ctx.actor.userId}:${requestId}`);
    if (!receipt) return null;
    if (receipt.operation !== operation || receipt.fingerprint !== fp) {
      throw new JwordError(
        "CONFLICT",
        "This request id was already used for a different command.",
        {
          reason: "REQUEST_ID_REUSED",
        },
      );
    }
    return { ...(receipt.result as WatchMutationResult), replayed: true };
  }

  private finishWatchRequest(
    ctx: MutationContext,
    requestId: string,
    operation: string,
    fp: string,
    result: WatchMutationResult,
  ): WatchMutationResult {
    this.receipts.set(`${ctx.actor.userId}:${requestId}`, { operation, fingerprint: fp, result });
    return { ...result, replayed: false };
  }

  /** Mirrors jword.resolve_board_url() for one board. */
  private resolveBoard(board: BoardInput): WatchBoard {
    const identifier = cleanText(board.boardIdentifier);
    const otherUrl = cleanText(board.boardUrl);
    const fail = (message: string, reason: string) =>
      new JwordError("VALIDATION_ERROR", message, { reason });
    if (board.provider === "OTHER") {
      if (identifier !== null)
        throw fail(
          "A board identifier applies only to Greenhouse, Lever, Ashby, or Workday.",
          "BOARD_IDENTIFIER_NOT_ALLOWED",
        );
      if (otherUrl === null)
        throw fail("An Other board needs its careers page URL.", "BOARD_URL_REQUIRED");
      return { provider: "OTHER", boardIdentifier: null, boardUrl: otherUrl };
    }
    if (identifier === null)
      throw fail("This provider needs a board identifier.", "BOARD_IDENTIFIER_REQUIRED");
    if (!isValidBoardIdentifier(board.provider, identifier))
      throw fail("Board identifier has an invalid format.", "BOARD_IDENTIFIER_INVALID");
    if (otherUrl !== null)
      throw fail("The board URL is set from the provider and identifier.", "BOARD_URL_DERIVED");
    return {
      provider: board.provider,
      boardIdentifier: identifier,
      boardUrl: canonicalBoardUrl(board.provider, identifier),
    };
  }

  /** Mirrors jword.normalize_boards(): shape, no duplicates, max three, not watched elsewhere. */
  private normalizeBoards(
    userId: string,
    boards: BoardInput[] | undefined,
    watchId: string | null,
  ): WatchBoard[] {
    const list = boards ?? [];
    if (list.length > MAX_BOARDS_PER_WATCH) {
      throw new JwordError("VALIDATION_ERROR", "A company can have at most three boards.", {
        reason: "TOO_MANY_BOARDS",
      });
    }
    const seen = new Set<string>();
    return list.map((input) => {
      const board = this.resolveBoard(input);
      const key = boardKey(board);
      if (seen.has(key))
        throw new JwordError("VALIDATION_ERROR", "The same board is listed twice.", {
          reason: "DUPLICATE_BOARD",
        });
      seen.add(key);
      if (board.boardIdentifier) {
        const clash = this.watches.find(
          (w) =>
            w.userId === userId &&
            w.id !== watchId &&
            w.boards.some((b) => b.boardIdentifier && boardKey(b) === key),
        );
        if (clash) {
          const company = this.companies.find((c) => c.id === clash.companyId)!.name;
          throw new JwordError("CONFLICT", `This board is already watched for ${company}.`, {
            reason: "BOARD_ALREADY_WATCHED",
            watchId: clash.id,
            company,
          });
        }
      }
      return board;
    });
  }

  private boardsLabel(boards: WatchBoard[]): string {
    if (!boards.length) return "no job board";
    return boards
      .map((b) =>
        b.provider === "OTHER"
          ? "careers page"
          : `${b.provider.charAt(0)}${b.provider.slice(1).toLowerCase()} ${b.boardIdentifier}`,
      )
      .join(", ");
  }

  private lockWatch(userId: string, watchId: string, expectedVersion: number): WatchRecord {
    const watch = this.watches.find((w) => w.userId === userId && w.id === watchId);
    if (!watch)
      throw new JwordError("NOT_FOUND", "Watched company not found.", {
        reason: "WATCH_NOT_FOUND",
      });
    if (watch.version !== expectedVersion) {
      throw new JwordError(
        "CONFLICT",
        "This watch changed since you opened it. Refresh before saving.",
        { reason: "STALE_VERSION", currentVersion: watch.version, expectedVersion },
      );
    }
    return watch;
  }

  /** Mirrors jword.apply_company_fields(). Notes text is never copied into before/after. */
  private applyCompanyFields(
    company: CompanyRecord,
    command: {
      interestLevel?: number | null;
      websiteUrl?: string | null;
      companyNotes?: string | null;
    },
  ) {
    const changed: string[] = [];
    const before: Record<string, SafeWatchValue> = {};
    const after: Record<string, SafeWatchValue> = {};
    if (
      command.interestLevel !== undefined &&
      command.interestLevel !== (company.interestLevel ?? null)
    ) {
      changed.push("interestLevel");
      before.interestLevel = company.interestLevel ?? null;
      after.interestLevel = command.interestLevel;
      company.interestLevel = command.interestLevel;
    }
    if (command.websiteUrl !== undefined) {
      const next = cleanText(command.websiteUrl);
      if (next !== (company.websiteUrl ?? null)) {
        changed.push("websiteUrl");
        before.websiteUrl = company.websiteUrl ?? null;
        after.websiteUrl = next;
        company.websiteUrl = next;
      }
    }
    if (command.companyNotes !== undefined) {
      const next = cleanText(command.companyNotes);
      if (next !== (company.notes ?? null)) {
        changed.push("companyNotes");
        company.notes = next;
      }
    }
    return { changed, before, after };
  }

  private addWatchActivity(
    userId: string,
    watchId: string,
    type: WatchActivity["type"],
    actorType: WatchActivity["actorType"],
    summary: string,
    metadata: Record<string, unknown>,
  ): WatchActivityRecord {
    if (this.failBeforeActivity)
      throw new JwordError("INTERNAL_ERROR", "Injected activity failure; transaction rolled back.");
    const ts = this.now();
    const record: WatchActivityRecord = {
      activityId: randomUUID(),
      userId,
      watchId,
      type,
      actorType,
      summary,
      metadata,
      occurredAt: ts,
      createdAt: ts,
    };
    this.watchActivities.push(record);
    return record;
  }

  async createWatch(
    ctx: MutationContext,
    command: AddWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const op = "create_company_watch";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginWatchRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const userId = ctx.actor.userId;
      const knownIds = new Set(this.companies.map((c) => c.id));
      const company = this.resolveCompany(userId, command.company, command.companyId);
      const companyCreated = !knownIds.has(company.id);
      const current = this.watches.find((w) => w.userId === userId && w.companyId === company.id);
      if (current) {
        throw new JwordError(
          "CONFLICT",
          `${company.name} is already on your watchlist${current.active ? "" : " (inactive)"}.`,
          {
            reason: "ALREADY_WATCHED",
            watchId: current.id,
            watchActive: current.active,
            currentVersion: current.version,
          },
        );
      }
      const boards = this.normalizeBoards(userId, command.boards, null);
      const ts = this.now();
      const watch: WatchRecord = {
        id: randomUUID(),
        userId,
        companyId: company.id,
        active: true,
        boards,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      };
      this.watches.push(watch);
      const companyChanges = this.applyCompanyFields(company, command);
      const changedFields = ["active", "boards", ...companyChanges.changed];
      const after = { active: true, boards: this.boardsLabel(boards), ...companyChanges.after };
      const summary = `Started watching ${company.name} (${this.boardsLabel(boards)})`;
      const activity = this.addWatchActivity(
        userId,
        watch.id,
        "WATCH_CREATED",
        ctx.actor.actorType,
        summary,
        {
          companyId: company.id,
          companyCreated,
          fields: changedFields,
          before: companyChanges.before,
          after,
          boards,
        },
      );
      return this.finishWatchRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        watchId: watch.id,
        companyId: company.id,
        company: company.name,
        companyCreated,
        active: true,
        version: 1,
        activityId: activity.activityId,
        summary,
        changedFields,
        before: companyChanges.before,
        after,
      });
    });
  }

  async updateWatch(
    ctx: MutationContext,
    command: UpdateWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const op = "update_company_watch";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginWatchRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const userId = ctx.actor.userId;
      const watch = this.lockWatch(userId, command.watchId, command.expectedVersion);
      const company = this.companies.find((c) => c.id === watch.companyId && c.userId === userId)!;
      const changedFields: string[] = [];
      const before: Record<string, SafeWatchValue> = {};
      const after: Record<string, SafeWatchValue> = {};
      if (command.boards !== undefined) {
        const next = this.normalizeBoards(userId, command.boards, watch.id);
        if (JSON.stringify(next) !== JSON.stringify(watch.boards)) {
          changedFields.push("boards");
          before.boards = this.boardsLabel(watch.boards);
          after.boards = this.boardsLabel(next);
          watch.boards = next;
        }
      }
      const companyChanges = this.applyCompanyFields(company, command);
      changedFields.push(...companyChanges.changed);
      Object.assign(before, companyChanges.before);
      Object.assign(after, companyChanges.after);
      const base = {
        ok: true as const,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        watchId: watch.id,
        companyId: company.id,
        company: company.name,
        active: watch.active,
      };
      if (!changedFields.length) {
        return this.finishWatchRequest(ctx, command.requestId, op, fp, {
          ...base,
          noop: true,
          version: watch.version,
          activityId: null,
          summary: "No changes to save.",
          changedFields: [],
          before: {},
          after: {},
        });
      }
      watch.version += 1;
      watch.updatedAt = this.now();
      const summary = `Updated watch for ${company.name}`;
      const activity = this.addWatchActivity(
        userId,
        watch.id,
        "WATCH_UPDATED",
        ctx.actor.actorType,
        summary,
        { fields: changedFields, before, after },
      );
      return this.finishWatchRequest(ctx, command.requestId, op, fp, {
        ...base,
        noop: false,
        version: watch.version,
        activityId: activity.activityId,
        summary,
        changedFields,
        before,
        after,
      });
    });
  }

  async deleteWatch(
    ctx: MutationContext,
    command: DeleteWatchedCompanyCommand,
  ): Promise<WatchMutationResult> {
    const op = "delete_company_watch";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginWatchRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const userId = ctx.actor.userId;
      const watch = this.lockWatch(userId, command.watchId, command.expectedVersion);
      const company = this.companies.find((c) => c.id === watch.companyId && c.userId === userId)!;
      const summary = `Deleted watch for ${company.name}`;
      const before = { active: watch.active, deleted: false };
      const after = { active: false, deleted: true };
      const activity = this.addWatchActivity(
        userId,
        watch.id,
        "WATCH_DELETED",
        ctx.actor.actorType,
        summary,
        {
          fields: ["deleted"],
          before,
          after,
          companyId: company.id,
          boardsBefore: structuredClone(watch.boards),
        },
      );
      this.watches = this.watches.filter((w) => w.id !== watch.id);
      return this.finishWatchRequest(ctx, command.requestId, op, fp, {
        ok: true,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        noop: false,
        watchId: watch.id,
        companyId: company.id,
        company: company.name,
        deleted: true,
        active: false,
        version: watch.version + 1,
        activityId: activity.activityId,
        summary,
        changedFields: ["deleted"],
        before,
        after,
      });
    });
  }

  async setWatchActive(
    ctx: MutationContext,
    command: SetCompanyWatchStatusCommand,
  ): Promise<WatchMutationResult> {
    const op = "set_company_watch_active";
    const fp = this.fingerprint(op, ctx, command);
    const existing = this.beginWatchRequest(ctx, command.requestId, op, fp);
    if (existing) return existing;
    return this.transaction(() => {
      const userId = ctx.actor.userId;
      const watch = this.lockWatch(userId, command.watchId, command.expectedVersion);
      const company = this.companies.find((c) => c.id === watch.companyId && c.userId === userId)!;
      const base = {
        ok: true as const,
        operation: op,
        requestId: command.requestId,
        replayed: false,
        watchId: watch.id,
        companyId: company.id,
        company: company.name,
        active: command.active,
      };
      if (watch.active === command.active) {
        return this.finishWatchRequest(ctx, command.requestId, op, fp, {
          ...base,
          noop: true,
          version: watch.version,
          activityId: null,
          summary: `${company.name} is already ${command.active ? "active" : "inactive"}.`,
          changedFields: [],
          before: {},
          after: {},
        });
      }
      const before = { active: watch.active };
      watch.active = command.active;
      watch.version += 1;
      watch.updatedAt = this.now();
      const summary = `${command.active ? "Resumed" : "Stopped"} watching ${company.name}`;
      const activity = this.addWatchActivity(
        userId,
        watch.id,
        command.active ? "WATCH_ACTIVATED" : "WATCH_DEACTIVATED",
        ctx.actor.actorType,
        summary,
        { fields: ["active"], before, after: { active: command.active } },
      );
      return this.finishWatchRequest(ctx, command.requestId, op, fp, {
        ...base,
        noop: false,
        version: watch.version,
        activityId: activity.activityId,
        summary,
        changedFields: ["active"],
        before,
        after: { active: command.active },
      });
    });
  }
}
