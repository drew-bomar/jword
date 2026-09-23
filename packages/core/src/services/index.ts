import type { ActorContext } from "../domain/actor";
import { ACTIVE_STATUSES, APPLICATION_STATUSES, type ApplicationStatus } from "../domain/enums";
import { creationDates, statusAppliedDate } from "../domain/date-policy";
import type { Clock } from "../domain/dates";
import { JwordError, toJwordError, type DuplicateCandidate } from "../domain/errors";
import type {
  ApplicationActivity,
  ApplicationDetail,
  ApplicationNote,
  ApplicationOverview,
  ApplicationSummary,
  CandidateProfile,
  MutationResult,
  Page,
  PipelineSummary,
  StatusCounts,
} from "../domain/types";
import {
  annotateDuplicates,
  applyMapping,
  missingRequiredMappings,
  parseCsv,
  validateImportRow,
  type ImportMapping,
  type ImportRowPreview,
} from "../import/index";
import type { Logger } from "../logging";
import { silentLogger } from "../logging";
import { createWatchlistServices } from "./watchlist";
import type {
  MutationContext,
  TrackerRepository,
  WatchlistRepository,
} from "../repositories/types";
import {
  addApplicationNoteSchema,
  candidateProfileSchema,
  commitImportSchema,
  createApplicationSchema,
  getApplicationSchema,
  listActivitySchema,
  parseOrThrow,
  pipelineSummarySchema,
  SEARCH_DEFAULT_LIMIT,
  searchApplicationsSchema,
  updateApplicationDetailsSchema,
  updateApplicationNoteSchema,
  updateApplicationStatusSchema,
  type CreateApplicationCommand,
} from "../validation/schemas";

export interface ServiceDependencies {
  repository: TrackerRepository & WatchlistRepository;
  clock: Clock;
  logger?: Logger;
}

export interface ApplicationView {
  application: ApplicationDetail;
  notes: Page<ApplicationNote>;
  activity: Page<ApplicationActivity>;
}

export interface ImportPreview {
  headers: string[];
  totalRows: number;
  blankRowsSkipped: number;
  rows: ImportRowPreview[];
  validCount: number;
  errorCount: number;
  flaggedCount: number;
}

export interface PreviewImportInput {
  csvText: string;
  mapping: ImportMapping;
}

const SAFE_SCALAR_FIELDS = new Set([
  "status",
  "priority",
  "appliedAt",
  "dateFound",
  "datePosted",
  "workArrangement",
]);

export function toSummary(item: ApplicationOverview): ApplicationSummary {
  return {
    applicationId: item.applicationId,
    company: item.company,
    title: item.title,
    status: item.status,
    priority: item.priority,
    version: item.version,
    location: item.location,
    appliedAt: item.appliedAt,
    lastActivityAt: item.lastActivityAt,
  };
}

export function countStatuses(statuses: ApplicationStatus[]): StatusCounts {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  for (const status of statuses) byStatus[status] += 1;
  const active = ACTIVE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  return { byStatus, total: statuses.length, active };
}

/** Keep only safe scalar before/after values for transport to agents and UI. */
export function safeMutationResult(result: MutationResult): MutationResult {
  const filter = (record: Record<string, string | null>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => SAFE_SCALAR_FIELDS.has(key)));
  return { ...result, before: filter(result.before), after: filter(result.after) };
}

/**
 * Shared application services. Both the web Server Actions and the MCP tools call these;
 * they validate input, attach actor + clock context, invoke the repository, and log.
 */
export function createTrackerServices(deps: ServiceDependencies) {
  const { repository, clock } = deps;
  const logger = deps.logger ?? silentLogger;

  async function run<T>(
    operation: string,
    actor: ActorContext,
    meta: { requestId?: string },
    fn: () => Promise<T>,
    extract?: (
      value: T,
    ) => Partial<{ applicationId: string; noteId: string; noop: boolean; replayed: boolean }>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const value = await fn();
      logger.log({
        operation,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        requestId: meta.requestId,
        ok: true,
        durationMs: Date.now() - started,
        ...(extract ? extract(value) : {}),
      });
      return value;
    } catch (error) {
      const typed = toJwordError(error);
      logger.log({
        operation,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        requestId: meta.requestId,
        ok: false,
        durationMs: Date.now() - started,
        errorCode: typed.code,
      });
      throw typed;
    }
  }

  function interactiveContext(actor: ActorContext): MutationContext {
    return { actor, today: clock.today() };
  }

  const mutationMeta = (r: MutationResult) => ({
    applicationId: r.applicationId,
    noteId: r.noteId ?? undefined,
    noop: r.noop,
    replayed: r.replayed,
  });

  return {
    // Company watchlist (decision 018): same repository, same entry points.
    ...createWatchlistServices({ repository, logger }),

    // ----------------------------------------------------------------- reads
    async searchApplications(
      input: unknown,
      actor: ActorContext,
    ): Promise<Page<ApplicationOverview>> {
      const query = parseOrThrow(searchApplicationsSchema, input ?? {});
      return run("search_applications", actor, {}, () =>
        repository.searchApplications(actor.userId, {
          ...query,
          limit: query.limit ?? SEARCH_DEFAULT_LIMIT,
        }),
      );
    },

    async getApplication(input: unknown, actor: ActorContext): Promise<ApplicationView> {
      const query = parseOrThrow(getApplicationSchema, input);
      return run("get_application", actor, {}, async () => {
        const application = await repository.getApplication(actor.userId, query.applicationId);
        if (!application) throw new JwordError("NOT_FOUND", "Application not found.");
        const [notes, activity] = await Promise.all([
          repository.listNotes(actor.userId, query.applicationId, {
            limit: query.notesLimit ?? 20,
            cursor: query.notesCursor,
          }),
          repository.listActivity(actor.userId, query.applicationId, {
            limit: query.activityLimit ?? 20,
            cursor: query.activityCursor,
          }),
        ]);
        return { application, notes, activity };
      });
    },

    async listApplicationActivity(
      input: unknown,
      actor: ActorContext,
    ): Promise<Page<ApplicationActivity>> {
      const query = parseOrThrow(listActivitySchema, input);
      return run("list_application_activity", actor, {}, async () => {
        const application = await repository.getApplication(actor.userId, query.applicationId);
        if (!application) throw new JwordError("NOT_FOUND", "Application not found.");
        return repository.listActivity(actor.userId, query.applicationId, {
          limit: query.limit ?? 20,
          cursor: query.cursor,
        });
      });
    },

    async getStatusCounts(actor: ActorContext): Promise<StatusCounts> {
      return run("status_counts", actor, {}, async () =>
        countStatuses(await repository.listStatuses(actor.userId)),
      );
    },

    async getPipelineSummary(input: unknown, actor: ActorContext): Promise<PipelineSummary> {
      const query = parseOrThrow(pipelineSummarySchema, input ?? {});
      const staleAfterDays = query.staleAfterDays ?? 14;
      const staleLimit = query.staleLimit ?? 10;
      return run("get_pipeline_summary", actor, {}, async () => {
        const counts = countStatuses(await repository.listStatuses(actor.userId));
        const threshold = new Date(
          clock.now().getTime() - staleAfterDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        const stale = await repository.searchApplications(actor.userId, {
          statuses: [...ACTIVE_STATUSES],
          updatedBefore: threshold,
          sort: "updated",
          direction: "asc",
          limit: staleLimit,
        });
        return { ...counts, staleAfterDays, stale: stale.items.map(toSummary) };
      });
    },

    // ------------------------------------------------------------- mutations
    async createApplication(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(createApplicationSchema, input);
      return run(
        "create_application",
        actor,
        { requestId: command.requestId },
        () => {
          const today = clock.today();
          const dates = creationDates(command, today);
          // Keep caller intent untouched for the retry fingerprint. SQL repeats the policy
          // at the write boundary; it receives a default day only when policy needs one.
          const needsDefault =
            (command.dateFound === undefined && dates.dateFound !== null) ||
            (command.appliedAt === undefined && dates.appliedAt !== null);
          return repository.createApplication(
            { actor, today: needsDefault ? today : null },
            command,
          );
        },
        mutationMeta,
      );
    },

    /** Read-only duplicate probe for forms; the database re-checks at commit. */
    async findDuplicateCandidates(
      input: unknown,
      actor: ActorContext,
    ): Promise<DuplicateCandidate[]> {
      const command = parseOrThrow(
        createApplicationSchema.pick({
          company: true,
          title: true,
          jobUrl: true,
          externalJobId: true,
        }),
        input,
      );
      return run("find_duplicates", actor, {}, async () => {
        const { findDuplicateCandidates, probeForRow } = await import("../import/validate");
        const index = await repository.listDuplicateIndex(actor.userId);
        return findDuplicateCandidates(probeForRow(command as CreateApplicationCommand), index);
      });
    },

    async updateApplicationStatus(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(updateApplicationStatusSchema, input);
      return run(
        "update_application_status",
        actor,
        { requestId: command.requestId },
        async () => {
          const current = await repository.getApplication(actor.userId, command.applicationId);
          if (!current) throw new JwordError("NOT_FOUND", "Application not found.");
          const today = clock.today();
          const resolved = statusAppliedDate(command, current, today);
          const needsDefault = command.appliedAt === undefined && resolved !== current.appliedAt;
          // The transaction still compares expectedVersion against its locked row, and
          // checks a committed receipt first. This read never authorizes a stale save.
          return repository.updateApplicationStatus(
            { actor, today: needsDefault ? today : null },
            command,
          );
        },
        mutationMeta,
      );
    },

    async updateApplicationDetails(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(updateApplicationDetailsSchema, input);
      return run(
        "update_application_details",
        actor,
        { requestId: command.requestId },
        () => repository.updateApplicationDetails(interactiveContext(actor), command),
        mutationMeta,
      );
    },

    async addApplicationNote(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(addApplicationNoteSchema, input);
      return run(
        "add_application_note",
        actor,
        { requestId: command.requestId },
        () => repository.addApplicationNote(interactiveContext(actor), command),
        mutationMeta,
      );
    },

    async updateApplicationNote(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(updateApplicationNoteSchema, input);
      return run(
        "update_application_note",
        actor,
        { requestId: command.requestId },
        () => repository.updateApplicationNote(interactiveContext(actor), command),
        mutationMeta,
      );
    },

    // ---------------------------------------------------------------- import
    /** Phase 1: parse, map, validate, and flag duplicates. Writes nothing. */
    async previewImport(input: PreviewImportInput, actor: ActorContext): Promise<ImportPreview> {
      return run("preview_import", actor, {}, async () => {
        const missing = missingRequiredMappings(input.mapping);
        if (missing.length) {
          throw new JwordError(
            "VALIDATION_ERROR",
            `Map the required columns first: ${missing.join(", ")}.`,
          );
        }
        const parsed = parseCsv(input.csvText);
        const previews = parsed.rows.map((row, index) =>
          validateImportRow(index + 1, applyMapping(row, input.mapping)),
        );
        const existing = await repository.listDuplicateIndex(actor.userId);
        const rows = annotateDuplicates(previews, existing);
        return {
          headers: parsed.headers,
          totalRows: parsed.rows.length,
          blankRowsSkipped: parsed.blankRowsSkipped,
          rows,
          validCount: rows.filter((r) => r.errors.length === 0).length,
          errorCount: rows.filter((r) => r.errors.length > 0).length,
          flaggedCount: rows.filter((r) => r.duplicates.length > 0 || r.duplicateOfRows.length > 0)
            .length,
        };
      });
    },

    /** Phase 2: commit the confirmed rows all-or-nothing. Imports never get date defaults. */
    async commitImport(input: unknown, actor: ActorContext): Promise<MutationResult> {
      const command = parseOrThrow(commitImportSchema, input);
      const importActor: ActorContext = { ...actor, actorType: "IMPORT" };
      return run(
        "import_applications",
        importActor,
        { requestId: command.requestId },
        () => repository.importApplications({ actor: importActor, today: null }, command),
        (r) => ({ noop: r.noop, replayed: r.replayed }),
      );
    },

    // --------------------------------------------------------------- profile
    async getCandidateProfile(actor: ActorContext): Promise<CandidateProfile | null> {
      return run("get_candidate_profile", actor, {}, () =>
        repository.getCandidateProfile(actor.userId),
      );
    },

    async saveCandidateProfile(input: unknown, actor: ActorContext): Promise<CandidateProfile> {
      const command = parseOrThrow(candidateProfileSchema, input);
      return run("save_candidate_profile", actor, {}, () =>
        repository.saveCandidateProfile(actor.userId, command),
      );
    },
  };
}

export type TrackerServices = ReturnType<typeof createTrackerServices>;

export * from "./watchlist";
