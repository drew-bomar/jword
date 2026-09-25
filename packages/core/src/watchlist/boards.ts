import type { AtsProvider } from "../domain/enums";

/**
 * Board identifiers of the name-based providers as they appear in public board URLs: a
 * Greenhouse board token, a Lever site slug, or an Ashby job-board name. Deliberately
 * conservative; mirrored by jword.canonical_board_url() in SQL.
 */
export const BOARD_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * A Workday board is `{account}/{cluster}/{site}` (decision 022), for example
 * `nvidia/wd5/NVIDIAExternalCareerSite`. The account is a DNS label and the cluster is
 * `wd` plus digits, both lowercase, because they become the board's hostname; the site keeps
 * its case for display. Mirrored by jword.canonical_board_url() in SQL.
 */
export const WORKDAY_IDENTIFIER_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/(wd[0-9]{1,3})\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})$/;

/** Longest identifier any provider accepts (Workday: 63 + 1 + 5 + 1 + 100). */
export const MAX_BOARD_IDENTIFIER_LENGTH = 170;

/** Providers whose boards jword can store, verify, and (later) read. */
export const SUPPORTED_BOARD_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY", "WORKDAY"] as const;
export type SupportedBoardProvider = (typeof SUPPORTED_BOARD_PROVIDERS)[number];

/**
 * Providers discovery may guess from a company name. Workday is excluded: its identifier has
 * an account, a cluster, and a site name that cannot be derived from a company name, so its
 * boards enter only through saved application links and pasted URLs.
 */
export const NAME_DISCOVERY_PROVIDERS = [
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
] as const satisfies readonly SupportedBoardProvider[];

export function isSupportedBoardProvider(value: AtsProvider): value is SupportedBoardProvider {
  return value !== "OTHER";
}

export interface WorkdayBoard {
  account: string;
  cluster: string;
  site: string;
}

/** Split a stored Workday identifier into its parts, or null when it is not one. */
export function parseWorkdayIdentifier(value: string): WorkdayBoard | null {
  const match = WORKDAY_IDENTIFIER_PATTERN.exec(value);
  return match ? { account: match[1]!, cluster: match[2]!, site: match[3]! } : null;
}

export function isValidBoardIdentifier(provider: SupportedBoardProvider, value: string): boolean {
  return provider === "WORKDAY"
    ? WORKDAY_IDENTIFIER_PATTERN.test(value)
    : BOARD_IDENTIFIER_PATTERN.test(value);
}

const BOARD_BASE: Record<Exclude<SupportedBoardProvider, "WORKDAY">, string> = {
  GREENHOUSE: "https://job-boards.greenhouse.io/",
  LEVER: "https://jobs.lever.co/",
  ASHBY: "https://jobs.ashbyhq.com/",
};

/**
 * The public board URL jword stores for a supported provider. Mirrors SQL. The identifier must
 * already be valid for the provider; Workday's URL is built only from its validated parts.
 */
export function canonicalBoardUrl(provider: SupportedBoardProvider, identifier: string): string {
  if (provider === "WORKDAY") {
    const board = parseWorkdayIdentifier(identifier);
    if (!board) return "";
    return `https://${board.account}.${board.cluster}.myworkdayjobs.com/${board.site}`;
  }
  return `${BOARD_BASE[provider]}${identifier}`;
}

export interface InferredBoard {
  provider: SupportedBoardProvider;
  boardIdentifier: string;
  boardUrl: string;
}

/** First path segments that are Greenhouse pages rather than board tokens. */
const GREENHOUSE_RESERVED = new Set(["embed"]);
/** Workday locale prefixes such as en-US or fr-CA. */
const WORKDAY_LOCALE = /^[a-z]{2}-[a-z]{2}$/i;
const WORKDAY_JOBS_HOST = /^([a-z0-9-]+)\.(wd[0-9]{1,3})\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST = /^(wd[0-9]{1,3})\.myworkdaysite\.com$/;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Workday's two public URL families (decision 022). Both name the same board, so both map to
 * the myworkdayjobs.com identity:
 *   {account}.{wdN}.myworkdayjobs.com/[{locale}/]{site}[/job/…]
 *   {wdN}.myworkdaysite.com/[{locale}/]recruiting/{account}/{site}[/job/…]
 */
function inferWorkday(host: string, segments: string[]): string | null {
  // A locale on its own is a language picker, not a board.
  const path = WORKDAY_LOCALE.test(segments[0] ?? "") ? segments.slice(1) : segments;
  let account: string | undefined;
  let cluster: string | undefined;
  let site: string | undefined;
  const jobsHost = WORKDAY_JOBS_HOST.exec(host);
  const siteHost = WORKDAY_SITE_HOST.exec(host);
  if (jobsHost) {
    [, account, cluster] = jobsHost;
    site = path[0];
    // /wday/cxs/... is Workday's data API, not a board page.
    if (site?.toLowerCase() === "wday") return null;
  } else if (siteHost) {
    if (path[0]?.toLowerCase() !== "recruiting") return null;
    cluster = siteHost[1];
    account = path[1]?.toLowerCase();
    site = path[2];
  } else {
    return null;
  }
  const decoded = site ? decodeSegment(site) : null;
  if (!account || !cluster || !decoded) return null;
  const identifier = `${account}/${cluster}/${decoded}`;
  return WORKDAY_IDENTIFIER_PATTERN.test(identifier) ? identifier : null;
}

/**
 * Recognize a Greenhouse, Lever, Ashby, or Workday public board from a pasted URL. Job-specific
 * path segments, locale prefixes, query strings, and fragments are ignored. Returns null for
 * anything else; the caller then keeps it as a careers page. Pure: no network access.
 */
export function inferBoardFromUrl(input: string): InferredBoard | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let provider: SupportedBoardProvider;
  let segment: string | undefined;
  switch (host) {
    case "boards.greenhouse.io":
    case "job-boards.greenhouse.io":
      provider = "GREENHOUSE";
      segment = segments[0];
      if (segment && GREENHOUSE_RESERVED.has(segment.toLowerCase())) return null;
      break;
    case "boards-api.greenhouse.io":
      provider = "GREENHOUSE";
      segment = segments[0] === "v1" && segments[1] === "boards" ? segments[2] : undefined;
      break;
    case "jobs.lever.co":
      provider = "LEVER";
      segment = segments[0];
      break;
    case "jobs.ashbyhq.com":
      provider = "ASHBY";
      segment = segments[0];
      break;
    default: {
      const identifier = inferWorkday(host, segments);
      if (!identifier) return null;
      return {
        provider: "WORKDAY",
        boardIdentifier: identifier,
        boardUrl: canonicalBoardUrl("WORKDAY", identifier),
      };
    }
  }

  const identifier = segment ? decodeSegment(segment) : null;
  if (!identifier || !isValidBoardIdentifier(provider, identifier)) return null;
  return {
    provider,
    boardIdentifier: identifier,
    boardUrl: canonicalBoardUrl(provider, identifier),
  };
}
