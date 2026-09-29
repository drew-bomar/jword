import * as z from "zod";
import { isIsoDate } from "../domain/dates";
import { createProviderHttp, decodeEntities, HttpStatusError, type Fetch } from "../discovery/http";
import { WORKDAY_REPORTED_TOTAL_CAP } from "../discovery/directory";
import {
  isValidBoardIdentifier,
  parseWorkdayIdentifier,
  type SupportedBoardProvider,
} from "../watchlist/boards";
import type {
  CollectedPosting,
  CollectionReason,
  CollectionResult,
  EmploymentType,
  JobCollector,
  WorkplaceType,
} from "./types";

export interface PublicJobCollectorOptions {
  /** Injected so tests never touch the network. Defaults to the global fetch. */
  fetch?: Fetch;
  /** Total time for one board, across all its pages. */
  timeoutMs?: number;
}

export const COLLECTION_TIMEOUT_MS = 45_000;
/** Postings kept per board; a larger board is reported as partial. */
export const MAX_POSTINGS_PER_BOARD = 5_000;
export const MAX_TITLE_LENGTH = 500;
export const MAX_LOCATION_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 10_000;
/** Locations kept per posting when a provider lists several. */
export const MAX_LOCATIONS = 20;
/** Greenhouse and Ashby return every posting with its description in one response. */
const FULL_BOARD_LIMIT = 30_000_000;
const PAGE_LIMIT = 5_000_000;
const LEVER_PAGE_SIZE = 100;
const LEVER_MAX_PAGES = 50;
/** Workday serves at most 20 postings per page. */
const WORKDAY_PAGE_SIZE = 20;
const WORKDAY_PAGE_CONCURRENCY = 4;

const text = z.string().trim().min(1);
const optionalText = z.string().nullish();
/** Structured extras never make a posting invalid: anything unexpected becomes undefined. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const optionalTimestamp = optionalText.refine(
  (value) =>
    !value ||
    (/^\d{4}-\d{2}-\d{2}T/.test(value) &&
      isIsoDate(value.slice(0, 10)) &&
      Number.isFinite(Date.parse(value))),
);
// Envelopes must match; each posting is checked on its own so one malformed entry makes the
// scan partial instead of failing the board.
const greenhouseJob = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]),
  title: text,
  location: z.object({ name: optionalText }).nullish(),
  content: optionalText,
  first_published: optionalTimestamp,
});
const greenhouseJobs = z.object({ jobs: z.array(z.unknown()) });
const leverJob = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  text,
  // commitment is free text ("Full-time", "Internship"); allLocations includes the primary.
  categories: z
    .object({
      location: optionalText,
      commitment: lenient(z.string()),
      allLocations: lenient(z.array(z.string())),
    })
    .nullish(),
  workplaceType: lenient(z.string()),
  descriptionPlain: optionalText,
  createdAt: z.number().int().nonnegative().max(253402300799999).nullish(),
});
const leverPage = z.array(z.unknown());
const ashbyJob = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  title: text,
  location: optionalText,
  descriptionPlain: optionalText,
  publishedAt: optionalTimestamp,
  isListed: z.boolean().optional(),
  // isRemote is not used: Ashby sets it on hybrid roles too.
  workplaceType: lenient(z.string()),
  employmentType: lenient(z.string()),
  secondaryLocations: lenient(z.array(z.object({ location: z.string() }).loose())),
});
const ashbyBoard = z.object({ jobs: z.array(z.unknown()) });
const workdayJob = z.object({
  title: text,
  externalPath: z.string().regex(/^\/job\/[^\s?#]{1,480}$/),
  locationsText: optionalText,
});
const workdayPage = z.object({
  total: z.number().int().nonnegative(),
  jobPostings: z.array(z.unknown()),
});

/** "OnSite" / "onsite" / "On-site" -> ONSITE; unknown values (e.g. "unspecified") -> null. */
export function workplaceTypeOf(value: string | null | undefined): WorkplaceType | null {
  const key = value?.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "onsite" || key === "inoffice") return "ONSITE";
  if (key === "hybrid") return "HYBRID";
  if (key === "remote") return "REMOTE";
  return null;
}

/** Ashby enums and Lever free text ("Full-time", "Internship", "Fixed-Term") -> normalized. */
export function employmentTypeOf(value: string | null | undefined): EmploymentType | null {
  const key = value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (!key) return null;
  if (/^(intern|internship|coop|interns)/.test(key)) return "INTERN";
  if (/^(fulltime|permanent|regular)/.test(key)) return "FULL_TIME";
  if (/^parttime/.test(key)) return "PART_TIME";
  if (/^(contract|contractor|freelance)/.test(key)) return "CONTRACT";
  if (/^(temporary|temp|fixedterm|seasonal)/.test(key)) return "TEMPORARY";
  return null;
}

/** Primary first, trimmed, de-duplicated, capped; omitted when only the primary exists. */
function locationList(primary: string | null, others: Array<string | null | undefined>) {
  const all = [primary, ...others]
    .map((l) => clip(l, MAX_LOCATION_LENGTH))
    .filter((l): l is string => Boolean(l));
  const unique = [...new Set(all)].slice(0, MAX_LOCATIONS);
  return unique.length > 1 ? { locations: unique } : {};
}

function clip(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Plain text from provider HTML: tags become line breaks or spaces; entities are decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function description(value: string | null | undefined): string | null {
  const plain = value?.trim();
  return plain ? plain.slice(0, MAX_DESCRIPTION_LENGTH) : null;
}

/** The calendar date written in an ISO timestamp, as the provider stated it. */
function isoDate(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4}-\d{2}-\d{2})T/.exec(value) : null;
  return match ? match[1]! : null;
}

function millisDate(value: number | null | undefined): string | null {
  return typeof value === "number" && value > 0 ? new Date(value).toISOString().slice(0, 10) : null;
}

class Postings {
  private readonly byId = new Map<string, CollectedPosting>();
  limited = false;
  invalid = false;
  repeated = false;

  /** Add each item that matches `schema`; remember that others were skipped. */
  each<T>(items: unknown[], schema: z.ZodType<T>, build: (item: T) => CollectedPosting | null) {
    for (const item of items) {
      const parsed = schema.safeParse(item);
      const posting = parsed.success ? build(parsed.data) : null;
      if (posting) this.add(posting);
      else if (!parsed.success) this.invalid = true;
    }
  }

  add(posting: CollectedPosting) {
    if (this.byId.has(posting.postingId)) {
      this.repeated = true;
      return;
    }
    if (this.byId.size >= MAX_POSTINGS_PER_BOARD) {
      this.limited = true;
      return;
    }
    this.byId.set(posting.postingId, posting);
    if (this.byId.size === MAX_POSTINGS_PER_BOARD) this.limited = true;
  }

  get size() {
    return this.byId.size;
  }

  list() {
    return [...this.byId.values()];
  }
}

function failure(error: unknown, signal: AbortSignal): CollectionReason {
  if (signal.aborted) return "TIME_LIMIT";
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID_RESPONSE";
  if (error instanceof HttpStatusError) return "PROVIDER_ERROR";
  return "PROVIDER_ERROR";
}

/**
 * Reads every public posting on a Greenhouse, Lever, Ashby, or Workday board (decision 024).
 * Only the provider hosts built from a validated identifier are contacted; redirects are
 * refused and bodies are size-limited (see ../discovery/http). Any doubt about completeness
 * yields `partial`, so collection never marks postings unavailable on incomplete evidence.
 *
 * - Greenhouse: boards-api.greenhouse.io `/jobs?content=true` (documented), one response.
 * - Lever: api.lever.co postings (documented), `skip`/`limit` pages of 100.
 * - Ashby: api.ashbyhq.com posting API (documented), one response; unlisted jobs are skipped.
 * - Workday: the jobs endpoint behind myworkdayjobs.com pages (undocumented, decision 022),
 *   pages of 20. Its total is capped at 2000, so a board at the cap is always partial.
 *   Workday shows only relative dates ("Posted Today"), so postedOn stays null.
 */
export function createPublicJobCollector(options: PublicJobCollectorOptions = {}): JobCollector {
  const http = createProviderHttp({ fetch: options.fetch });
  const timeoutMs = options.timeoutMs ?? COLLECTION_TIMEOUT_MS;

  async function greenhouse(token: string, signal: AbortSignal): Promise<CollectionResult> {
    const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
    const raw = await http.json(`${base}?content=true`, signal, {}, FULL_BOARD_LIMIT);
    if (raw === undefined) return failed("BOARD_NOT_FOUND");
    const postings = new Postings();
    postings.each(greenhouseJobs.parse(raw).jobs, greenhouseJob, (job) => {
      const id = String(job.id);
      return {
        postingId: id,
        title: clip(job.title, MAX_TITLE_LENGTH)!,
        location: clip(job.location?.name, MAX_LOCATION_LENGTH),
        jobUrl: `https://job-boards.greenhouse.io/${encodeURIComponent(token)}/jobs/${id}`,
        // Greenhouse escapes its HTML content once more.
        description: description(job.content ? htmlToText(decodeEntities(job.content)) : null),
        postedOn: isoDate(job.first_published),
      };
    });
    return settle(postings, null);
  }

  async function lever(site: string, signal: AbortSignal): Promise<CollectionResult> {
    const postings = new Postings();
    for (let page = 0; page < LEVER_MAX_PAGES; page += 1) {
      let items: unknown[];
      try {
        const raw = await http.json(
          `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${page * LEVER_PAGE_SIZE}&limit=${LEVER_PAGE_SIZE}`,
          signal,
          {},
          PAGE_LIMIT,
        );
        if (raw === undefined) {
          if (page === 0) return failed("BOARD_NOT_FOUND");
          return partial(postings, "PAGE_FAILED");
        }
        items = leverPage.parse(raw);
      } catch (error) {
        if (page === 0) throw error;
        return partial(
          postings,
          failure(error, signal) === "TIME_LIMIT" ? "TIME_LIMIT" : "PAGE_FAILED",
        );
      }
      postings.each(items, leverJob, (job) => {
        const location = clip(job.categories?.location, MAX_LOCATION_LENGTH);
        return {
          postingId: job.id,
          title: clip(job.text, MAX_TITLE_LENGTH)!,
          location,
          jobUrl: `https://jobs.lever.co/${encodeURIComponent(site)}/${job.id}`,
          description: description(job.descriptionPlain),
          postedOn: millisDate(job.createdAt),
          ...locationList(location, job.categories?.allLocations ?? []),
          workplaceType: workplaceTypeOf(job.workplaceType),
          employmentType: employmentTypeOf(job.categories?.commitment),
        };
      });
      if (items.length < LEVER_PAGE_SIZE) {
        return settle(postings, postings.repeated ? "COUNT_MISMATCH" : null);
      }
    }
    return partial(postings, "POSTING_LIMIT");
  }

  async function ashby(name: string, signal: AbortSignal): Promise<CollectionResult> {
    const raw = await http.json(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}`,
      signal,
      {},
      FULL_BOARD_LIMIT,
    );
    if (raw === undefined) return failed("BOARD_NOT_FOUND");
    const postings = new Postings();
    postings.each(ashbyBoard.parse(raw).jobs, ashbyJob, (job) =>
      job.isListed === false
        ? null
        : {
            postingId: job.id,
            title: clip(job.title, MAX_TITLE_LENGTH)!,
            location: clip(job.location, MAX_LOCATION_LENGTH),
            jobUrl: `https://jobs.ashbyhq.com/${encodeURIComponent(name)}/${job.id}`,
            description: description(job.descriptionPlain),
            postedOn: isoDate(job.publishedAt),
            ...locationList(
              clip(job.location, MAX_LOCATION_LENGTH),
              (job.secondaryLocations ?? []).map((l) => l.location),
            ),
            workplaceType: workplaceTypeOf(job.workplaceType),
            employmentType: employmentTypeOf(job.employmentType),
          },
    );
    return settle(postings, null);
  }

  async function workday(id: string, signal: AbortSignal): Promise<CollectionResult> {
    const board = parseWorkdayIdentifier(id);
    if (!board) return failed("BOARD_NOT_FOUND");
    const { account, cluster, site } = board;
    const host = `https://${account}.${cluster}.myworkdayjobs.com`;
    const endpoint = `${host}/wday/cxs/${encodeURIComponent(account)}/${encodeURIComponent(site)}/jobs`;
    const page = async (offset: number) =>
      http.json(
        endpoint,
        signal,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appliedFacets: {},
            limit: WORKDAY_PAGE_SIZE,
            offset,
            searchText: "",
          }),
        },
        PAGE_LIMIT,
      );
    const postings = new Postings();
    const addPage = (raw: unknown) => {
      const parsed = workdayPage.parse(raw);
      postings.each(parsed.jobPostings, workdayJob, (job) => ({
        postingId: job.externalPath,
        title: clip(job.title, MAX_TITLE_LENGTH)!,
        location: clip(job.locationsText, MAX_LOCATION_LENGTH),
        jobUrl: `${host}/${site}${job.externalPath}`,
        description: null,
        postedOn: null,
      }));
      return parsed;
    };

    const first = await page(0);
    if (first === undefined) return failed("BOARD_NOT_FOUND");
    // Only the first page reports the total; later pages report 0.
    const total = addPage(first).total;
    const reachable = Math.min(total, WORKDAY_REPORTED_TOTAL_CAP);
    const offsets: number[] = [];
    for (let offset = WORKDAY_PAGE_SIZE; offset < reachable; offset += WORKDAY_PAGE_SIZE) {
      offsets.push(offset);
    }
    let pageFailure: CollectionReason | null = null;
    let next = 0;
    async function worker() {
      while (next < offsets.length && !pageFailure) {
        const offset = offsets[next++]!;
        try {
          const raw = await page(offset);
          if (raw === undefined) pageFailure = "PAGE_FAILED";
          else addPage(raw);
        } catch (error) {
          pageFailure = failure(error, signal) === "TIME_LIMIT" ? "TIME_LIMIT" : "PAGE_FAILED";
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(WORKDAY_PAGE_CONCURRENCY, offsets.length) }, worker),
    );
    const result = settle(postings, pageFailure);
    result.reportedTotal = total;
    if (result.status !== "complete") return result;
    if (total >= WORKDAY_REPORTED_TOTAL_CAP)
      return { ...result, status: "partial", reason: "TOTAL_CAPPED" };
    // Postings can move between pages while paging; a shortfall means some were missed.
    if (postings.size !== total || postings.repeated)
      return { ...result, status: "partial", reason: "COUNT_MISMATCH" };
    return result;
  }

  const collectors: Record<
    SupportedBoardProvider,
    (identifier: string, signal: AbortSignal) => Promise<CollectionResult>
  > = { GREENHOUSE: greenhouse, LEVER: lever, ASHBY: ashby, WORKDAY: workday };

  return {
    async collect(provider, identifier, callerSignal) {
      if (!isValidBoardIdentifier(provider, identifier)) return failed("BOARD_NOT_FOUND");
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      try {
        signal.throwIfAborted();
        return await collectors[provider](identifier, signal);
      } catch (error) {
        return failed(failure(error, signal));
      }
    },
  };
}

function failed(reason: CollectionReason): CollectionResult {
  return { status: "failed", reason, postings: [], reportedTotal: null };
}

function partial(postings: Postings, reason: CollectionReason): CollectionResult {
  return { status: "partial", reason, postings: postings.list(), reportedTotal: null };
}

/** Complete unless a page failed, a posting was malformed, or the posting limit was reached. */
function settle(postings: Postings, pageFailure: CollectionReason | null): CollectionResult {
  if (pageFailure) return partial(postings, pageFailure);
  if (postings.limited) return partial(postings, "POSTING_LIMIT");
  if (postings.invalid) return partial(postings, "INVALID_POSTINGS");
  return { status: "complete", reason: null, postings: postings.list(), reportedTotal: null };
}
