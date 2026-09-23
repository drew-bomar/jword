import type { ActorContext } from "../domain/actor";
import { JwordError, toJwordError } from "../domain/errors";
import type { Page } from "../domain/types";
import { silentLogger, type Logger } from "../logging";
import type { MutationContext, WatchlistRepository } from "../repositories/types";
import { parseOrThrow } from "../validation/schemas";
import {
  addWatchedCompanySchema,
  getWatchedCompanySchema,
  listWatchedCompaniesSchema,
  searchCompaniesSchema,
  setCompanyWatchStatusSchema,
  updateWatchedCompanySchema,
  WATCHLIST_DEFAULT_LIMIT,
} from "../watchlist/schemas";
import type {
  CompanyOption,
  WatchActivity,
  WatchedCompany,
  WatchMutationResult,
} from "../watchlist/types";

export interface WatchlistServiceDependencies {
  repository: WatchlistRepository;
  logger?: Logger;
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
  const { repository } = deps;
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
