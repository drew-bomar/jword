import type { ActorContext } from "../domain/actor";
import { JwordError, toJwordError } from "../domain/errors";
import type { Page } from "../domain/types";
import { silentLogger, type Logger } from "../logging";
import type { MutationContext, WatchlistRepository } from "../repositories/types";
import { parseOrThrow } from "../validation/schemas";
import { boardNameCandidates } from "../discovery/candidates";
import { untilAborted } from "../discovery/cancellation";
import { rateBoard } from "../discovery/rank";
import type {
  ApplicationWatchSuggestion,
  BoardConfidence,
  BoardDirectory,
  BoardDiscoveryResult,
  BoardSuggestion,
  ProbeOutcome,
} from "../discovery/types";
import {
  canonicalBoardUrl,
  inferBoardFromUrl,
  SUPPORTED_BOARD_PROVIDERS,
  type InferredBoard,
} from "../watchlist/boards";
import {
  addWatchedCompanySchema,
  boardKey,
  discoverBoardsSchema,
  getWatchedCompanySchema,
  MAX_BOARDS_PER_WATCH,
  listWatchedCompaniesSchema,
  searchCompaniesSchema,
  setCompanyWatchStatusSchema,
  updateWatchedCompanySchema,
  WATCHLIST_DEFAULT_LIMIT,
} from "../watchlist/schemas";
import type {
  CompanyOption,
  CompanyRef,
  WatchActivity,
  WatchedCompany,
  WatchMutationResult,
} from "../watchlist/types";

export interface WatchlistServiceDependencies {
  repository: WatchlistRepository;
  logger?: Logger;
  /** Public board lookups (decision 019). Without one, discovery uses local evidence only. */
  boardDirectory?: BoardDirectory;
}

const PROBE_CONCURRENCY = 6;
export const MAX_DISCOVERY_PROBES = 15;
export const DISCOVERY_TIMEOUT_MS = 12_000;
const CONFIDENCE_ORDER: Record<BoardConfidence, number> = { high: 0, medium: 1, low: 2 };

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Supported boards named in job URLs, in first-seen order, without duplicates. */
function boardsFromUrls(urls: string[]): InferredBoard[] {
  const out: InferredBoard[] = [];
  for (const url of urls) {
    const board = inferBoardFromUrl(url);
    if (board && !out.some((b) => boardKey(b) === boardKey(board))) out.push(board);
  }
  return out;
}

export interface WatchedCompanyView {
  watch: WatchedCompany;
  activity: Page<WatchActivity>;
}

/**
 * Company watchlist services (decision 018). The web Server Actions and the MCP tools both call
 * these. Validation happens here; ownership, uniqueness, versions, the audit row, and the
 * retry receipt are enforced inside the database transaction. Nothing here fetches jobs.
 */
export function createWatchlistServices(deps: WatchlistServiceDependencies) {
  const { repository, boardDirectory } = deps;
  const logger = deps.logger ?? silentLogger;

  async function run<T>(
    operation: string,
    actor: ActorContext,
    requestId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const value = await fn();
      const mutation = value as Partial<WatchMutationResult>;
      logger.log({
        operation,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        requestId,
        ok: true,
        durationMs: Date.now() - started,
        ...(requestId
          ? { watchId: mutation.watchId, noop: mutation.noop, replayed: mutation.replayed }
          : {}),
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

  // Watch mutations have no date defaults.
  const context = (actor: ActorContext): MutationContext => ({ actor, today: null });

  return {
    // ----------------------------------------------------------------- reads
    async listWatchedCompanies(input: unknown, actor: ActorContext): Promise<Page<WatchedCompany>> {
      const query = parseOrThrow(listWatchedCompaniesSchema, input ?? {});
      return run("list_watched_companies", actor, undefined, () =>
        repository.listWatches(actor.userId, {
          ...query,
          limit: query.limit ?? WATCHLIST_DEFAULT_LIMIT,
        }),
      );
    },

    async getWatchedCompany(input: unknown, actor: ActorContext): Promise<WatchedCompanyView> {
      const query = parseOrThrow(getWatchedCompanySchema, input);
      return run("get_watched_company", actor, undefined, async () => {
        const watch = await repository.getWatch(actor.userId, query.watchId);
        if (!watch) {
          throw new JwordError("NOT_FOUND", "Watched company not found.", {
            reason: "WATCH_NOT_FOUND",
          });
        }
        const activity = await repository.listWatchActivity(actor.userId, query.watchId, {
          limit: query.activityLimit ?? 10,
        });
        return { watch, activity };
      });
    },

    /** Existing companies for the add form's picker, each with its watch if it has one. */
    async searchCompanies(input: unknown, actor: ActorContext): Promise<CompanyOption[]> {
      const query = parseOrThrow(searchCompaniesSchema, input);
      return run("search_companies", actor, undefined, () =>
        repository.searchCompanies(actor.userId, query.text, query.limit ?? 8),
      );
    },

    /**
     * Find a company's likely public job boards. Evidence comes from the owner's saved job URLs
     * (no network) and, when a directory is configured, from Greenhouse, Lever, and Ashby's
     * public APIs, tried with names generated from the company name and website. Returns
     * ranked suggestions with reasons; it never saves anything. The owner picks.
     */
    async discoverCompanyBoards(
      input: unknown,
      actor: ActorContext,
      options: { signal?: AbortSignal } = {},
    ): Promise<BoardDiscoveryResult> {
      const query = parseOrThrow(discoverBoardsSchema, input);
      return run("discover_company_boards", actor, undefined, async () => {
        const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const warnings: string[] = [];
        async function optionalRead<T>(
          read: () => Promise<T>,
          fallback: T,
          warning: string,
        ): Promise<T> {
          try {
            signal.throwIfAborted();
            return await untilAborted(read(), signal);
          } catch (error) {
            if (toJwordError(error).code !== "INTERNAL_ERROR") throw error;
            warnings.push(warning);
            return fallback;
          }
        }
        let company: CompanyRef | null = null;
        if (query.companyId) {
          signal.throwIfAborted();
          company = await untilAborted(
            repository.getCompany(actor.userId, query.companyId),
            signal,
          );
          if (!company) {
            throw new JwordError("NOT_FOUND", "Selected company was not found.", {
              reason: "COMPANY_NOT_FOUND",
            });
          }
        } else if (query.company) {
          company = await optionalRead(
            () => repository.findCompanyByName(actor.userId, query.company!),
            null,
            "Saved company details could not be checked; these results use the name you entered.",
          );
        }
        const name = company?.name ?? query.company!;
        const website = query.websiteUrl ?? company?.websiteUrl ?? null;
        const fromApplications = company
          ? boardsFromUrls(
              await optionalRead(
                () => repository.listCompanyJobUrls(actor.userId, company!.companyId),
                [],
                "Saved application links could not be checked.",
              ),
            )
          : [];
        const candidates = boardNameCandidates(name, website);

        const targets: InferredBoard[] = [...fromApplications];
        if (boardDirectory) {
          for (const identifier of candidates) {
            for (const provider of SUPPORTED_BOARD_PROVIDERS) {
              const board = {
                provider,
                boardIdentifier: identifier,
                boardUrl: canonicalBoardUrl(provider, identifier),
              };
              if (!targets.some((t) => boardKey(t) === boardKey(board))) targets.push(board);
            }
          }
        }
        // Only optional enrichment degrades. A selected company ID above must still be authorized.
        const summaries = await optionalRead(
          () => repository.listWatchSummaries(actor.userId),
          null,
          "Existing watches could not be checked. Board ownership is unknown; confirm choices before adding.",
        );
        const watchers = new Map<string, { watchId: string; company: string }>();
        for (const watch of summaries ?? []) {
          for (const board of watch.boards) {
            watchers.set(boardKey(board), { watchId: watch.watchId, company: watch.company });
          }
        }
        if (targets.length > MAX_DISCOVERY_PROBES)
          warnings.push(
            `Only the first ${MAX_DISCOVERY_PROBES} boards were checked. Remaining saved links are unverified.`,
          );
        const outcomes: ProbeOutcome[] = await mapPool(
          targets,
          PROBE_CONCURRENCY,
          async (target) => {
            if (
              !boardDirectory ||
              signal.aborted ||
              targets.indexOf(target) >= MAX_DISCOVERY_PROBES
            )
              return { status: "error" };
            try {
              return await untilAborted(
                boardDirectory.probe(target.provider, target.boardIdentifier, signal),
                signal,
              );
            } catch {
              return { status: "error" };
            }
          },
        );

        const suggestions: BoardSuggestion[] = [];
        targets.forEach((target, index) => {
          const outcome = outcomes[index]!;
          const linked = fromApplications.some((b) => boardKey(b) === boardKey(target));
          if (outcome.status !== "found" && !linked) return;
          const { confidence, reasons } = rateBoard({
            company: name,
            companyWebsite: website,
            boardIdentifier: target.boardIdentifier,
            candidates,
            fromApplications: linked,
            outcome,
          });
          const found = outcome.status === "found" ? outcome : null;
          suggestions.push({
            provider: target.provider,
            boardIdentifier: target.boardIdentifier,
            boardUrl: target.boardUrl,
            confidence,
            reasons,
            boardName: found?.boardName ?? null,
            openJobs: found?.openJobs ?? null,
            openJobsAtLeast: found?.openJobsAtLeast ?? false,
            sampleTitles: found?.sampleTitles ?? [],
            fromApplications: linked,
            watchedBy: watchers.get(boardKey(target)) ?? null,
          });
        });
        suggestions.sort(
          (a, b) =>
            CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
            Number(b.fromApplications) - Number(a.fromApplications) ||
            (b.openJobs ?? -1) - (a.openJobs ?? -1),
        );

        const unavailable = boardDirectory
          ? SUPPORTED_BOARD_PROVIDERS.filter((provider) => {
              const tried = targets
                .map((t, i) => ({ t, o: outcomes[i]! }))
                .filter((x) => x.t.provider === provider);
              return tried.length > 0 && tried.every((x) => x.o.status === "error");
            })
          : [...SUPPORTED_BOARD_PROVIDERS];

        return {
          company: name,
          companyId: company?.companyId ?? null,
          candidates,
          suggestions,
          unavailable,
          incomplete: SUPPORTED_BOARD_PROVIDERS.filter(
            (provider) =>
              !unavailable.includes(provider) &&
              targets.some(
                (target, index) =>
                  target.provider === provider && outcomes[index]!.status === "error",
              ),
          ),
          ownershipChecked: summaries !== null,
          warnings,
        };
      });
    },

    /**
     * Companies you applied to but do not watch yet, with the boards their saved job URLs
     * point at (up to three each). Local data only; no network calls.
     */
    async suggestWatchesFromApplications(
      actor: ActorContext,
    ): Promise<ApplicationWatchSuggestion[]> {
      return run("suggest_watches_from_applications", actor, undefined, async () => {
        const [rows, watches] = await Promise.all([
          repository.listApplicationJobUrls(actor.userId),
          repository.listWatchSummaries(actor.userId),
        ]);
        const watchedCompanies = new Set(watches.map((w) => w.companyId));
        const watchedBoards = new Set(watches.flatMap((w) => w.boards.map(boardKey)));
        const byCompany = new Map<string, { company: string; urls: string[] }>();
        for (const row of rows) {
          if (watchedCompanies.has(row.companyId)) continue;
          const entry = byCompany.get(row.companyId) ?? { company: row.company, urls: [] };
          entry.urls.push(row.jobUrl);
          byCompany.set(row.companyId, entry);
        }
        const out: ApplicationWatchSuggestion[] = [];
        for (const [companyId, entry] of byCompany) {
          const boards = boardsFromUrls(entry.urls)
            .filter((b) => !watchedBoards.has(boardKey(b)))
            .slice(0, MAX_BOARDS_PER_WATCH);
          if (!boards.length) continue;
          out.push({
            companyId,
            company: entry.company,
            applicationCount: entry.urls.length,
            boards,
          });
        }
        return out.sort(
          (a, b) => b.applicationCount - a.applicationCount || a.company.localeCompare(b.company),
        );
      });
    },

    // ------------------------------------------------------------- mutations
    /**
     * Watch a company, reusing an exact name match or the selected company id, or creating
     * the company. An existing watch (active or not) is a CONFLICT/ALREADY_WATCHED carrying
     * its id, so the caller can offer to reactivate it. Never touches applications or jobs.
     */
    async addWatchedCompany(input: unknown, actor: ActorContext): Promise<WatchMutationResult> {
      const command = parseOrThrow(addWatchedCompanySchema, input);
      return run("add_watched_company", actor, command.requestId, () =>
        repository.createWatch(context(actor), command),
      );
    },

    /** Edit board configuration and the reused company fields. Requires expectedVersion. */
    async updateWatchedCompany(input: unknown, actor: ActorContext): Promise<WatchMutationResult> {
      const command = parseOrThrow(updateWatchedCompanySchema, input);
      return run("update_watched_company", actor, command.requestId, () =>
        repository.updateWatch(context(actor), command),
      );
    },

    /** Deactivate ("remove from watchlist") or reactivate. Deletes nothing. */
    async setCompanyWatchStatus(input: unknown, actor: ActorContext): Promise<WatchMutationResult> {
      const command = parseOrThrow(setCompanyWatchStatusSchema, input);
      return run("set_company_watch_status", actor, command.requestId, () =>
        repository.setWatchActive(context(actor), command),
      );
    },
  };
}

export type WatchlistServices = ReturnType<typeof createWatchlistServices>;
