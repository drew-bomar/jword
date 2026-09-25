import * as z from "zod";
import { isValidBoardIdentifier, type SupportedBoardProvider } from "../watchlist/boards";
import type { BoardDirectory, ProbeOutcome } from "./types";

type Fetch = typeof fetch;

export interface PublicBoardDirectoryOptions {
  /** Injected so tests never touch the network. Defaults to the global fetch. */
  fetch?: Fetch;
  /** Total timeout for one board, including optional detail or fallback requests. */
  timeoutMs?: number;
}

const USER_AGENT = "jword/0.1 (personal job tracker; board lookup)";
const SAMPLE_TITLES = 3;
const JSON_LIMIT = 5_000_000;
const HTML_LIMIT = 64_000;
const title = z.string().trim().min(1).max(2000);
const greenhouseBoard = z.object({ name: title });
const greenhouseJobs = z.object({
  jobs: z.array(z.object({ title })),
  meta: z.object({ total: z.number().int().nonnegative() }).optional(),
});
const leverJobs = z.array(z.object({ text: title }));
const ashbyOrganization = z.object({
  organization: z
    .object({ name: title, publicWebsite: z.string().nullable().optional() })
    .nullable(),
});
const ashbyJobs = z.object({ jobBoard: z.object({ jobPostings: z.array(z.object({ title })) }) });
const publicAshbyJobs = z.object({
  jobs: z.array(z.object({ title, isListed: z.boolean().optional() })),
});
const graphqlResponse = z.object({
  data: z.record(z.string(), z.unknown()),
  errors: z.array(z.unknown()).optional(),
});

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Read at most `limit` bytes of a response body; longer bodies are cut, never buffered whole. */
async function readText(
  response: Response,
  limit: number,
): Promise<{ text: string; cut: boolean }> {
  if (!response.body) return { text: "", cut: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= limit) {
      cut = true;
      await reader.cancel();
      break;
    }
  }
  const joined = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, joined.length - offset));
    joined.set(part, offset);
    offset += part.length;
  }
  return { text: new TextDecoder().decode(joined), cut };
}

function titlesFrom(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) =>
      item && typeof item === "object" ? (item as { title?: unknown; text?: unknown }) : {},
    )
    .map((item) =>
      typeof item.title === "string" ? item.title : typeof item.text === "string" ? item.text : "",
    )
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, SAMPLE_TITLES);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Reads the public, unauthenticated board APIs of Greenhouse, Lever, and Ashby. Only these
 * fixed hosts are contacted; the board name is pattern-checked and URL-encoded, so a caller
 * cannot point it anywhere else. Nothing is stored. Any failure becomes `{ status: "error" }`.
 *
 * - Greenhouse: boards-api.greenhouse.io (documented) gives the board's company name and job count.
 * - Lever: api.lever.co (documented) gives existence and a page of postings; the hosted page's
 *   <title> (first 64 KB only) gives the company name.
 * - Ashby: the GraphQL endpoint behind jobs.ashbyhq.com (undocumented) gives the organization's
 *   name and website plus posting titles in a few KB, instead of the documented posting API's
 *   multi-megabyte descriptions. Contract failures fall back to the documented posting API within
 *   the same byte/time limits, without claiming name or website evidence.
 */
export function createPublicBoardDirectory(
  options: PublicBoardDirectoryOptions = {},
): BoardDirectory {
  const doFetch: Fetch = options.fetch ?? ((...args) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 6000;

  async function request(
    url: string,
    signal: AbortSignal,
    init: RequestInit = {},
    limit = JSON_LIMIT,
  ) {
    const response = await doFetch(url, {
      ...init,
      redirect: "error",
      signal,
      cache: "no-store",
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/html", ...init.headers },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return { missing: true as const };
      throw new HttpStatusError(response.status);
    }
    return { missing: false as const, ...(await readText(response, limit)) };
  }

  async function json(
    url: string,
    signal: AbortSignal,
    init?: RequestInit,
  ): Promise<unknown | undefined> {
    const result = await request(url, signal, init);
    if (result.missing) return undefined;
    if (result.cut) throw new Error("response too large");
    return JSON.parse(result.text) as unknown;
  }

  async function greenhouse(id: string, signal: AbortSignal): Promise<ProbeOutcome> {
    const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(id)}`;
    const raw = await json(base, signal);
    if (raw === undefined) return { status: "missing" };
    const board = greenhouseBoard.parse(raw);
    let openJobs: number | null = null;
    let sampleTitles: string[] = [];
    try {
      const jobs = greenhouseJobs.parse(await json(`${base}/jobs`, signal));
      openJobs = jobs.meta?.total ?? jobs.jobs.length;
      sampleTitles = titlesFrom(jobs?.jobs);
    } catch {
      // The board exists; the job list is optional detail.
    }
    return {
      status: "found",
      boardName: typeof board.name === "string" && board.name.trim() ? board.name.trim() : null,
      website: null,
      openJobs,
      openJobsAtLeast: false,
      sampleTitles,
    };
  }

  async function lever(id: string, signal: AbortSignal): Promise<ProbeOutcome> {
    const pageSize = 5;
    const postings = await json(
      `https://api.lever.co/v0/postings/${encodeURIComponent(id)}?mode=json&limit=${pageSize}`,
      signal,
    );
    if (postings === undefined) return { status: "missing" };
    const list = leverJobs.parse(postings);
    let boardName: string | null = null;
    try {
      const page = await request(
        `https://jobs.lever.co/${encodeURIComponent(id)}`,
        signal,
        {},
        HTML_LIMIT,
      );
      const match = page.missing ? null : /<title>([^<]{1,200})<\/title>/i.exec(page.text);
      boardName = match ? decodeEntities(match[1]!) || null : null;
    } catch {
      // Name is optional evidence.
    }
    return {
      status: "found",
      boardName,
      website: null,
      openJobs: list.length,
      openJobsAtLeast: list.length >= pageSize,
      sampleTitles: titlesFrom(list),
    };
  }

  async function ashbyQuery(operationName: string, query: string, id: string, signal: AbortSignal) {
    const body = graphqlResponse.parse(
      await json(`https://jobs.ashbyhq.com/api/non-user-graphql?op=${operationName}`, signal, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationName,
          variables: { organizationHostedJobsPageName: id, searchContext: "JobBoard" },
          query,
        }),
      }),
    );
    if (body.errors?.length) throw new Error("unexpected Ashby response");
    return body.data;
  }

  async function ashby(id: string, signal: AbortSignal): Promise<ProbeOutcome> {
    let org: z.infer<typeof ashbyOrganization>["organization"];
    try {
      org = ashbyOrganization.parse(
        await ashbyQuery(
          "ApiOrganizationFromHostedJobsPageName",
          "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, $searchContext: OrganizationSearchContext) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) { name publicWebsite } }",
          id,
          signal,
        ),
      ).organization;
    } catch {
      // The documented API is a fallback for an internal contract failure. It cannot prove a
      // company-name or website match, so it must not invent that evidence for ranking.
      signal.throwIfAborted();
      const raw = await json(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(id)}`,
        signal,
      );
      if (raw === undefined) return { status: "missing" };
      const jobs = publicAshbyJobs.parse(raw).jobs.filter((job) => job.isListed !== false);
      return {
        status: "found",
        boardName: null,
        website: null,
        openJobs: jobs.length,
        openJobsAtLeast: false,
        sampleTitles: titlesFrom(jobs),
      };
    }
    if (org === null) return { status: "missing" };
    let openJobs: number | null = null;
    let sampleTitles: string[] = [];
    try {
      const board = ashbyJobs.parse(
        await ashbyQuery(
          "ApiJobBoardWithTeams",
          "query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) { jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) { jobPostings { id title } } }",
          id,
          signal,
        ),
      ).jobBoard;
      openJobs = board.jobPostings.length;
      sampleTitles = titlesFrom(board.jobPostings);
    } catch {
      // Organization identity was verified; counts are optional, never guessed as zero.
    }
    return {
      status: "found",
      boardName: org.name,
      website: org.publicWebsite ?? null,
      openJobs,
      openJobsAtLeast: false,
      sampleTitles,
    };
  }

  const probes: Record<
    SupportedBoardProvider,
    (id: string, signal: AbortSignal) => Promise<ProbeOutcome>
  > = {
    GREENHOUSE: greenhouse,
    LEVER: lever,
    ASHBY: ashby,
  };

  return {
    async probe(provider, identifier, callerSignal) {
      if (!isValidBoardIdentifier(identifier)) return { status: "missing" };
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
        signal.throwIfAborted();
        return await probes[provider](identifier, signal);
      } catch {
        return { status: "error" };
      }
    },
  };
}
