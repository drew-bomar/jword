import type { ActorContext } from "../domain/actor";
import type { Clock } from "../domain/dates";
import { JwordError, toJwordError } from "../domain/errors";
import type { Page } from "../domain/types";
import { silentLogger, type Logger } from "../logging";
import type { CollectionResult, JobCollector } from "../collection/types";
import type { LeadsRepository, MutationContext, WatchlistRepository } from "../repositories/types";
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
  LeadMutationResult,
} from "../leads/types";

export interface LeadServiceDependencies {
  repository: LeadsRepository & WatchlistRepository;
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
  };
  for (const board of boards) {
    totals[board.status] += 1;
    totals.found += board.found;
    totals.created += board.created;
    totals.updated += board.updated;
    totals.relisted += board.relisted;
    totals.markedUnavailable += board.markedUnavailable;
  }
  return totals;
}

const SCAN_STATUS = { complete: "COMPLETE", partial: "PARTIAL", failed: "FAILED" } as const;

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
      const counts = collected.postings.length
        ? await repository.recordLeadPostings(ctx, scanId, collected.postings)
        : { created: 0, updated: 0, relisted: 0 };
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
          const boards = await mapPool(tasks, BOARD_CHECK_CONCURRENCY, ({ watch, board }) =>
            checkBoard(actor, watch, board, budget),
          );
          return { watchId: query.watchId ?? null, boards, totals: totalsOf(boards) };
        },
        (result) => ({
          ...(result.watchId ? { watchId: result.watchId } : {}),
          boards: result.totals.boards,
          created: result.totals.created,
          markedUnavailable: result.totals.markedUnavailable,
          incompleteBoards: result.totals.partial + result.totals.failed,
        }),
      );
    },

    async listLeads(input: unknown, actor: ActorContext): Promise<Page<Lead>> {
      const query = parseOrThrow(listLeadsSchema, input ?? {});
      return run("list_leads", actor, undefined, () =>
        repository.listLeads(actor.userId, {
          ...query,
          limit: query.limit ?? LEADS_DEFAULT_LIMIT,
        }),
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
