import { isValidBoardIdentifier, type SupportedBoardProvider } from "../watchlist/boards";
import type { BoardDirectory, ProbeOutcome } from "./types";

type Fetch = typeof fetch;

export interface PublicBoardDirectoryOptions {
  /** Injected so tests never touch the network. Defaults to the global fetch. */
  fetch?: Fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

const USER_AGENT = "jword/0.1 (personal job tracker; board lookup)";
const SAMPLE_TITLES = 3;
const JSON_LIMIT = 5_000_000;
const HTML_LIMIT = 64_000;

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
 *   multi-megabyte descriptions. If it changes, Ashby lookups report "could not reach".
 */
export function createPublicBoardDirectory(
  options: PublicBoardDirectoryOptions = {},
): BoardDirectory {
  const doFetch: Fetch = options.fetch ?? ((...args) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 6000;

  async function request(url: string, init: RequestInit = {}, limit = JSON_LIMIT) {
    const response = await doFetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/html", ...init.headers },
    });
    if (response.status === 404) return { missing: true as const };
    if (!response.ok) throw new HttpStatusError(response.status);
    return { missing: false as const, ...(await readText(response, limit)) };
  }

  async function json(url: string, init?: RequestInit): Promise<unknown | undefined> {
    const result = await request(url, init);
    if (result.missing) return undefined;
    if (result.cut) throw new Error("response too large");
    return JSON.parse(result.text) as unknown;
  }

  async function greenhouse(id: string): Promise<ProbeOutcome> {
    const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(id)}`;
    const board = (await json(base)) as { name?: unknown } | undefined;
    if (!board) return { status: "missing" };
    let openJobs: number | null = null;
    let sampleTitles: string[] = [];
    try {
      const jobs = (await json(`${base}/jobs`)) as { jobs?: unknown; meta?: { total?: unknown } };
      openJobs =
        typeof jobs?.meta?.total === "number"
          ? jobs.meta.total
          : Array.isArray(jobs?.jobs)
            ? jobs.jobs.length
            : null;
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

  async function lever(id: string): Promise<ProbeOutcome> {
    const pageSize = 5;
    const postings = await json(
      `https://api.lever.co/v0/postings/${encodeURIComponent(id)}?mode=json&limit=${pageSize}`,
    );
    if (postings === undefined) return { status: "missing" };
    const list = Array.isArray(postings) ? postings : [];
    let boardName: string | null = null;
    try {
      const page = await request(`https://jobs.lever.co/${encodeURIComponent(id)}`, {}, HTML_LIMIT);
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

  async function ashbyQuery(operationName: string, query: string, id: string) {
    const body = (await json(`https://jobs.ashbyhq.com/api/non-user-graphql?op=${operationName}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName,
        variables: { organizationHostedJobsPageName: id, searchContext: "JobBoard" },
        query,
      }),
    })) as { data?: Record<string, unknown>; errors?: unknown } | undefined;
    if (!body || body.errors || !body.data) throw new Error("unexpected Ashby response");
    return body.data;
  }

  async function ashby(id: string): Promise<ProbeOutcome> {
    const org = (
      await ashbyQuery(
        "ApiOrganizationFromHostedJobsPageName",
        "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, $searchContext: OrganizationSearchContext) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) { name publicWebsite } }",
        id,
      )
    ).organization as { name?: unknown; publicWebsite?: unknown } | null;
    if (!org) return { status: "missing" };
    let openJobs: number | null = null;
    let sampleTitles: string[] = [];
    try {
      const board = (
        await ashbyQuery(
          "ApiJobBoardWithTeams",
          "query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) { jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) { jobPostings { id title } } }",
          id,
        )
      ).jobBoard as { jobPostings?: unknown } | null;
      if (board && Array.isArray(board.jobPostings)) {
        openJobs = board.jobPostings.length;
        sampleTitles = titlesFrom(board.jobPostings);
      }
    } catch {
      // Postings are optional detail.
    }
    return {
      status: "found",
      boardName: typeof org.name === "string" && org.name.trim() ? org.name.trim() : null,
      website: typeof org.publicWebsite === "string" ? org.publicWebsite : null,
      openJobs,
      openJobsAtLeast: false,
      sampleTitles,
    };
  }

  const probes: Record<SupportedBoardProvider, (id: string) => Promise<ProbeOutcome>> = {
    GREENHOUSE: greenhouse,
    LEVER: lever,
    ASHBY: ashby,
  };

  return {
    async probe(provider, identifier) {
      if (!isValidBoardIdentifier(identifier)) return { status: "missing" };
      try {
        return await probes[provider](identifier);
      } catch {
        return { status: "error" };
      }
    },
  };
}
