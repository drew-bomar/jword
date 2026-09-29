import type { ActorContext } from "../domain/actor";
import type { Clock } from "../domain/dates";
import { JwordError, toJwordError } from "../domain/errors";
import type { Page } from "../domain/types";
import { silentLogger, type Logger } from "../logging";
import type { CollectionResult, JobCollector } from "../collection/types";
import type {
  LeadsRepository,
  MutationContext,
  TrackerRepository,
  WatchlistRepository,
} from "../repositories/types";
import {
  evaluatePosting,
  evaluationKey,
  toStoredEvaluation,
  type EvaluationContext,
} from "../leads/evaluate";
import { saveSearchPreferencesSchema } from "../preferences/schemas";
import { type PreferencesMutationResult, type SearchPreferences } from "../preferences/types";
import { parseOrThrow } from "../validation/schemas";
import { isSupportedBoardProvider, type SupportedBoardProvider } from "../watchlist/boards";
import type { WatchBoard, WatchedCompany } from "../watchlist/types";
import {
  checkForNewJobsSchema,
  createApplicationFromLeadSchema,
  getLeadSchema,
  LEADS_DEFAULT_LIMIT,
  listLeadsSchema,
  setLeadReviewStatusSchema,
} from "../leads/schemas";
import type {
  BoardCheckReport,
  JobCheckResult,
  JobCheckTotals,
  Lead,
  LeadCompany,
  LeadDetail,
  LeadListQuery,
  LeadMutationResult,
} from "../leads/types";

export interface LeadServiceDependencies {
  repository: LeadsRepository &
    WatchlistRepository &
    Pick<TrackerRepository, "getCandidateProfile">;
  clock: Clock;
  logger?: Logger;
  /** Reads provider boards (decision 024). Without one, checks fail with a setup error. */
  jobCollector?: JobCollector;
}

/** Boards read at the same time during one check. */
export const BOARD_CHECK_CONCURRENCY = 3;
/** A whole check stops starting new boards after this; Vercel functions allow 300 seconds. */
export const JOB_CHECK_BUDGET_MS = 240_000;
const WATCH_PAGE = 200;
/** Leads read and re-evaluated per round trip. */
const EVALUATION_PAGE = 250;

const FATAL = new Set(["UNAUTHENTICATED", "FORBIDDEN"]);

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  return results;
}

function totalsOf(boards: BoardCheckReport[]): JobCheckTotals {
  const totals: JobCheckTotals = {
    boards: boards.length,
    complete: 0,
    partial: 0,
    failed: 0,
    unsupported: 0,
    found: 0,
    created: 0,
    updated: 0,
    relisted: 0,
    markedUnavailable: 0,
    filtered: 0,
    filteredReasons: {},
  };
  for (const board of boards) {
    totals[board.status] += 1;
    totals.found += board.found;
    totals.created += board.created;
    totals.updated += board.updated;
    totals.relisted += board.relisted;
    totals.markedUnavailable += board.markedUnavailable;
    totals.filtered += board.filtered;
    for (const [reason, count] of Object.entries(board.filteredReasons)) {
      totals.filteredReasons[reason] = (totals.filteredReasons[reason] ?? 0) + count;
    }
  }
  return totals;
}

const SCAN_STATUS = { complete: "COMPLETE", partial: "PARTIAL", failed: "FAILED" } as const;

/** YYYY-MM-DD minus whole days (calendar arithmetic, no timezone). */
function minusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

interface EvaluationSnapshot {
  ctx: EvaluationContext;
  preferences: SearchPreferences | null;
  /** 0 when the owner has not saved preferences. */
  preferencesVersion: number;
}

/**
 * Job collection and the Leads inbox (decision 024). Collection reads watched boards through
 * the JobCollector and saves postings as leads; it never creates applications and never
 * changes a lead's review status. Only a complete scan marks unseen postings unavailable.
 * Review changes and application creation follow the usual version, audit, and retry rules.
 */
export function createLeadServices(deps: LeadServiceDependencies) {
  const { repository, jobCollector, clock } = deps;
  const logger = deps.logger ?? silentLogger;

  async function run<T>(
    operation: string,
    actor: ActorContext,
    requestId: string | undefined,
    fn: () => Promise<T>,
    meta: (value: T) => Record<string, unknown> = () => ({}),
  ): Promise<T> {
    const started = Date.now();
    try {
      const value = await fn();
      logger.log({
        operation,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        requestId,
        ok: true,
        durationMs: Date.now() - started,
        ...meta(value),
      });
      return value;
    } catch (error) {
      const typed = toJwordError(error);
      logger.log({
        operation,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        requestId,
        ok: false,
        durationMs: Date.now() - started,
        errorCode: typed.code,
      });
      throw typed;
    }
  }

  const context = (actor: ActorContext): MutationContext => ({ actor, today: null });

  /** One consistent read of preferences + graduation date; a scan uses it throughout. */
  async function snapshot(userId: string): Promise<EvaluationSnapshot> {
    const [preferences, profile] = await Promise.all([
      repository.getSearchPreferences(userId),
      repository.getCandidateProfile(userId),
    ]);
    const graduationDate = profile?.graduationDate ?? null;
    const preferencesVersion = preferences?.version ?? 0;
    return {
      preferences,
      preferencesVersion,
      ctx: {
        preferences,
        graduationDate,
        key: evaluationKey(preferencesVersion, graduationDate),
      },
    };
  }

  /**
   * Re-evaluate every lead whose stored evaluation was made with other preferences, another
   * graduation date, or older rules. Changes evaluation columns only: never review status,
   * availability, or version, and never deletes. A changed settings snapshot is rejected;
   * saves report an incomplete re-check that can be retried without repeating the mutation.
   */
  async function reevaluate(actor: ActorContext): Promise<number> {
    const current = await snapshot(actor.userId);
    let updated = 0;
    let afterId: string | undefined;
    for (;;) {
      const rows = await repository.listLeadsToEvaluate(actor.userId, {
        key: current.ctx.key,
        afterId,
        limit: EVALUATION_PAGE,
      });
      if (rows.length === 0) break;
      const evaluations = rows.map((row) => ({
        leadId: row.leadId,
        expectedInputRevision: row.inputRevision,
        evaluation: toStoredEvaluation(evaluatePosting(row, current.ctx), current.ctx.key),
      }));
      const applied = await repository.applyLeadEvaluations(
        context(actor),
        current.preferencesVersion,
        evaluations,
        current.ctx.graduationDate,
      );
      updated += applied.updated;
      if (rows.length < EVALUATION_PAGE) break;
      afterId = rows[rows.length - 1]!.leadId;
    }
    return updated;
  }

  async function activeWatches(userId: string): Promise<WatchedCompany[]> {
    const out: WatchedCompany[] = [];
    let cursor: string | undefined;
    do {
      const page = await repository.listWatches(userId, {
        active: true,
        limit: WATCH_PAGE,
        cursor,
      });
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  /** Read one board and save what was read. Never throws except for authorization failures. */
  async function checkBoard(
    actor: ActorContext,
    watch: WatchedCompany,
    board: WatchBoard,
    budget: AbortSignal,
    evaluation: EvaluationContext,
  ): Promise<BoardCheckReport> {
    const report: BoardCheckReport = {
      watchId: watch.watchId,
      companyId: watch.companyId,
      company: watch.company,
      provider: board.provider,
      boardIdentifier: board.boardIdentifier,
      boardUrl: board.boardUrl,
      status: "failed",
      reason: null,
      found: 0,
      created: 0,
      updated: 0,
      relisted: 0,
      markedUnavailable: 0,
      filtered: 0,
      filteredReasons: {},
      reportedTotal: null,
    };
    if (!isSupportedBoardProvider(board.provider) || !board.boardIdentifier) {
      return { ...report, status: "unsupported", reason: "UNSUPPORTED_BOARD" };
    }
    if (budget.aborted) return { ...report, reason: "NOT_CHECKED" };
    const provider: SupportedBoardProvider = board.provider;
    const ctx = context(actor);

    let scanId: string;
    try {
      ({ scanId } = await repository.beginLeadScan(ctx, {
        watchId: watch.watchId,
        provider,
        boardIdentifier: board.boardIdentifier,
      }));
    } catch (error) {
      const typed = toJwordError(error);
      if (FATAL.has(typed.code)) throw typed;
      if (typed.details.reason === "SCAN_IN_PROGRESS") return { ...report, reason: "IN_PROGRESS" };
      if (typed.code === "NOT_FOUND") return { ...report, reason: "NOT_CHECKED" };
      return { ...report, reason: "SAVE_FAILED" };
    }

    let collected: CollectionResult;
    try {
      collected = await jobCollector!.collect(provider, board.boardIdentifier, budget);
    } catch {
      collected = { status: "failed", reason: "PROVIDER_ERROR", postings: [], reportedTotal: null };
    }
    let status = collected.status;
    let reason: BoardCheckReport["reason"] = collected.reason;
    try {
      // Evaluate before saving: a new posting a hard rule excludes is counted, not stored.
      const evaluated = collected.postings.map((posting) => ({
        ...posting,
        evaluation: toStoredEvaluation(evaluatePosting(posting, evaluation), evaluation.key),
      }));
      const counts = evaluated.length
        ? await repository.recordLeadPostings(ctx, scanId, evaluated)
        : { created: 0, updated: 0, relisted: 0, filtered: 0, filteredReasons: {} };
      Object.assign(report, counts, { found: collected.postings.length });
    } catch (error) {
      const typed = toJwordError(error);
      if (FATAL.has(typed.code)) throw typed;
      // Some chunks may have been saved; nothing may be marked unavailable.
      status = "partial";
      reason = "SAVE_FAILED";
    }
    let markedUnavailable: number;
    try {
      ({ markedUnavailable } = await repository.finishLeadScan(ctx, {
        scanId,
        status: SCAN_STATUS[status],
        reason,
        reportedTotal: collected.reportedTotal,
      }));
    } catch (error) {
      const typed = toJwordError(error);
      if (FATAL.has(typed.code)) throw typed;
      // The finish may have committed before its response was lost. Do not claim that
      // availability was unchanged, and do not abort the other boards in this check.
      return {
        ...report,
        status: "failed",
        reason: "FINISH_UNCONFIRMED",
        reportedTotal: collected.reportedTotal,
      };
    }
    return {
      ...report,
      status,
      reason,
      markedUnavailable,
      reportedTotal: collected.reportedTotal,
    };
  }

  return {
    /**
     * Check one watched company (any state) or every active watch for new postings. Boards are
     * read a few at a time; one board failing never stops the others. Careers pages are
     * reported as unsupported. Returns per-board outcomes and totals.
     */
    async checkForNewJobs(
      input: unknown,
      actor: ActorContext,
      options: { signal?: AbortSignal } = {},
    ): Promise<JobCheckResult> {
      const query = parseOrThrow(checkForNewJobsSchema, input ?? {});
      return run(
        "check_for_new_jobs",
        actor,
        undefined,
        async () => {
          if (!jobCollector) {
            throw new JwordError("INTERNAL_ERROR", "Job collection is not configured.");
          }
          let watches: WatchedCompany[];
          if (query.watchId) {
            const watch = await repository.getWatch(actor.userId, query.watchId);
            if (!watch) {
              throw new JwordError("NOT_FOUND", "Watched company not found.", {
                reason: "WATCH_NOT_FOUND",
              });
            }
            watches = [watch];
          } else {
            watches = await activeWatches(actor.userId);
          }
          const timeout = AbortSignal.timeout(JOB_CHECK_BUDGET_MS);
          const budget = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
          const tasks = watches.flatMap((watch) => watch.boards.map((board) => ({ watch, board })));
          // One preference snapshot for the whole check, so every board is judged alike.
          const scanSnapshot = await snapshot(actor.userId);
          const boards = await mapPool(tasks, BOARD_CHECK_CONCURRENCY, ({ watch, board }) =>
            checkBoard(actor, watch, board, budget, scanSnapshot.ctx),
          );
          // Leads saved with an older snapshot (preferences edited mid-check) or never
          // evaluated are brought up to date. A failure here never loses the check result.
          let reevaluated = 0;
          try {
            // run() logs the failure; the check result is still returned.
            reevaluated = await run("reevaluate_leads", actor, undefined, () => reevaluate(actor));
          } catch (error) {
            if (FATAL.has(toJwordError(error).code)) throw error;
          }
          return {
            watchId: query.watchId ?? null,
            boards,
            totals: totalsOf(boards),
            reevaluated,
          };
        },
        (result) => ({
          ...(result.watchId ? { watchId: result.watchId } : {}),
          boards: result.totals.boards,
          created: result.totals.created,
          markedUnavailable: result.totals.markedUnavailable,
          filtered: result.totals.filtered,
          incompleteBoards: result.totals.partial + result.totals.failed,
        }),
      );
    },

    /**
     * List leads in one view (decision 026). RECOMMENDED (default) hides filtered-out leads,
     * and remote-only leads when the owner prefers; REMOTE shows only remote-only leads;
     * FILTERED shows leads a hard rule now excludes; ALL shows everything. The optional
     * posting-age limit applies to RECOMMENDED and REMOTE and keeps undated postings.
     */
    async listLeads(input: unknown, actor: ActorContext): Promise<Page<Lead>> {
      const { view = "RECOMMENDED", ...query } = parseOrThrow(listLeadsSchema, input ?? {});
      return run("list_leads", actor, undefined, async () => {
        const filters: LeadListQuery = { ...query, limit: query.limit ?? LEADS_DEFAULT_LIMIT };
        if (view === "RECOMMENDED" || view === "REMOTE") {
          const preferences = await repository.getSearchPreferences(actor.userId);
          filters.match = "NOT_EXCLUDED";
          if (view === "REMOTE") filters.arrangement = "REMOTE";
          else if (preferences?.hideRemoteOnly) filters.arrangement = "NOT_REMOTE";
          if (preferences?.maxPostingAgeDays) {
            filters.postedOnOrAfter = minusDays(clock.today(), preferences.maxPostingAgeDays);
          }
        } else if (view === "FILTERED") {
          filters.match = "EXCLUDED";
        }
        return repository.listLeads(actor.userId, filters);
      });
    },

    /** The owner's saved search preferences, or null before the first save. */
    async getSearchPreferences(actor: ActorContext): Promise<SearchPreferences | null> {
      return run("get_search_preferences", actor, undefined, () =>
        repository.getSearchPreferences(actor.userId),
      );
    },

    /**
     * Save the whole preference set (version-checked, retry-safe, audited), then re-evaluate
     * existing leads. Re-evaluation never deletes, dismisses, or changes availability. New
     * postings skipped under earlier preferences can only appear on the next check.
     */
    async saveSearchPreferences(
      input: unknown,
      actor: ActorContext,
    ): Promise<PreferencesMutationResult> {
      const command = parseOrThrow(saveSearchPreferencesSchema, input);
      return run(
        "save_search_preferences",
        actor,
        command.requestId,
        async () => {
          const result = await repository.saveSearchPreferences(context(actor), command);
          try {
            return {
              ...result,
              reevaluated: await run("reevaluate_leads", actor, command.requestId, () =>
                reevaluate(actor),
              ),
              reevaluationPending: false,
            };
          } catch (error) {
            // The save committed; stale evaluations are refreshed by the next check or save.
            const typed = toJwordError(error);
            if (FATAL.has(typed.code)) throw typed;
            return { ...result, reevaluationPending: true };
          }
        },
        (r) => ({ noop: r.noop, replayed: r.replayed, reevaluated: r.reevaluated }),
      );
    },

    /** Bring every lead's stored evaluation up to date with current preferences and rules. */
    async reevaluateLeads(actor: ActorContext): Promise<{ updated: number }> {
      return run(
        "reevaluate_leads",
        actor,
        undefined,
        async () => ({ updated: await reevaluate(actor) }),
        (r) => ({ updated: r.updated }),
      );
    },

    async getLead(input: unknown, actor: ActorContext): Promise<LeadDetail> {
      const { leadId } = parseOrThrow(getLeadSchema, input);
      return run("get_lead", actor, undefined, async () => {
        const lead = await repository.getLead(actor.userId, leadId);
        if (!lead)
          throw new JwordError("NOT_FOUND", "Lead not found.", { reason: "LEAD_NOT_FOUND" });
        return lead;
      });
    },

    /** Companies that have leads, for the inbox filter; includes companies no longer watched. */
    async listLeadCompanies(actor: ActorContext): Promise<LeadCompany[]> {
      return run("list_lead_companies", actor, undefined, () =>
        repository.listLeadCompanies(actor.userId),
      );
    },

    /** Dismiss a lead or restore it to New. Availability is unaffected. */
    async setLeadReviewStatus(input: unknown, actor: ActorContext): Promise<LeadMutationResult> {
      const command = parseOrThrow(setLeadReviewStatusSchema, input);
      return run(
        "set_lead_review_status",
        actor,
        command.requestId,
        () => repository.setLeadReviewStatus(context(actor), command),
        (r) => ({ leadId: r.leadId, noop: r.noop, replayed: r.replayed }),
      );
    },

    /**
     * Create a SAVED application from the lead and link them in one transaction. The usual
     * duplicate check applies (CONFLICT / DUPLICATE_CANDIDATES until allowDuplicate is set).
     */
    async createApplicationFromLead(
      input: unknown,
      actor: ActorContext,
    ): Promise<LeadMutationResult> {
      const command = parseOrThrow(createApplicationFromLeadSchema, input);
      return run(
        "create_application_from_lead",
        actor,
        command.requestId,
        () => repository.createApplicationFromLead({ actor, today: clock.today() }, command),
        (r) => ({
          leadId: r.leadId,
          applicationId: r.applicationId ?? undefined,
          replayed: r.replayed,
        }),
      );
    },
  };
}

export type LeadServices = ReturnType<typeof createLeadServices>;
