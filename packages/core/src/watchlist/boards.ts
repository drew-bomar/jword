import type { AtsProvider } from "../domain/enums";

/**
 * Board identifiers as they appear in public board URLs: a Greenhouse board token, a Lever
 * site slug, or an Ashby job-board name. Deliberately conservative; mirrored by the
 * company_watches check constraint and jword.resolve_board_url() in SQL.
 */
export const BOARD_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const SUPPORTED_BOARD_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;
export type SupportedBoardProvider = (typeof SUPPORTED_BOARD_PROVIDERS)[number];

export function isSupportedBoardProvider(value: AtsProvider): value is SupportedBoardProvider {
  return value !== "OTHER";
}

export function isValidBoardIdentifier(value: string): boolean {
  return BOARD_IDENTIFIER_PATTERN.test(value);
}

const BOARD_BASE: Record<SupportedBoardProvider, string> = {
  GREENHOUSE: "https://job-boards.greenhouse.io/",
  LEVER: "https://jobs.lever.co/",
  ASHBY: "https://jobs.ashbyhq.com/",
};

/** The public board URL jword stores for a supported provider. Mirrors SQL. */
export function canonicalBoardUrl(provider: SupportedBoardProvider, identifier: string): string {
  return `${BOARD_BASE[provider]}${identifier}`;
}

export interface InferredBoard {
  provider: SupportedBoardProvider;
  boardIdentifier: string;
  boardUrl: string;
}

/** First path segments that are Greenhouse pages rather than board tokens. */
const GREENHOUSE_RESERVED = new Set(["embed"]);

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Recognize a Greenhouse, Lever, or Ashby public board from a pasted URL. Job-specific path
 * segments, query strings, and fragments are ignored. Returns null for anything else; the
 * caller then lets the owner choose the provider by hand. Pure: no network access.
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
    default:
      return null;
  }

  const identifier = segment ? decodeSegment(segment) : null;
  if (!identifier || !isValidBoardIdentifier(identifier)) return null;
  return {
    provider,
    boardIdentifier: identifier,
    boardUrl: canonicalBoardUrl(provider, identifier),
  };
}
