import { z } from "zod";
import { WORK_ARRANGEMENTS, type WorkArrangement } from "../domain/enums";
import { isIsoDate } from "../domain/dates";
import { cleanText } from "../domain/normalize";

/**
 * A job posting read from a web page by the jword browser extension (decision 016).
 *
 * The payload crosses a trust boundary: it comes from arbitrary third-party page markup, via the
 * extension, into the capture page. The shape check below is deliberately generous so a long
 * description or odd date never blocks a capture; `normalizeCapturedPosting` then produces values
 * that fit the tracker's own limits. The shared create/update schemas still validate the final
 * command on the server, so nothing here is authoritative.
 */
export const CAPTURE_PAYLOAD_VERSION = 1;

const looseText = (max: number) => z.string().max(max).nullable().optional();

export const capturedPostingPayloadSchema = z.strictObject({
  version: z.literal(CAPTURE_PAYLOAD_VERSION),
  /** Page the posting was read from. Used for display and as a jobUrl fallback. */
  pageUrl: z.string().max(4096),
  /** Which extractor produced the values, e.g. "greenhouse" or "generic". */
  extractor: z.string().max(40),
  /** Set when the extension could not read the page at all. */
  error: looseText(500),
  company: looseText(1000),
  title: looseText(1000),
  jobUrl: looseText(4096),
  externalJobId: looseText(1000),
  location: looseText(2000),
  workArrangement: z.enum(WORK_ARRANGEMENTS).nullable().optional(),
  description: looseText(200_000),
  datePosted: looseText(100),
  source: looseText(1000),
  /** Fields whose value is a guess (e.g. company taken from a URL slug) and deserves review. */
  guessed: z.array(z.string().max(40)).max(20).optional(),
});
export type CapturedPostingPayload = z.infer<typeof capturedPostingPayloadSchema>;

/** Normalized posting whose values fit the create/update command limits. */
export interface CapturedPosting {
  pageUrl: string;
  extractor: string;
  error: string | null;
  company: string | null;
  title: string | null;
  jobUrl: string | null;
  externalJobId: string | null;
  location: string | null;
  workArrangement: WorkArrangement | null;
  description: string | null;
  datePosted: string | null;
  source: string | null;
  guessed: string[];
}

/** Limits mirror createApplicationSchema / updateApplicationDetailsSchema. */
export const CAPTURE_LIMITS = {
  company: 200,
  title: 200,
  jobUrl: 2048,
  externalJobId: 100,
  location: 200,
  description: 10_000,
  source: 100,
} as const;

function oneLine(value: string | null | undefined, max: number): string | null {
  const text = cleanText(value?.replace(/\s+/g, " "));
  return text === null ? null : truncate(text, max);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Keep paragraph breaks, drop runs of blank lines and trailing spaces. */
function multiLine(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : truncate(text, max);
}

function httpUrl(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text || text.length > CAPTURE_LIMITS.jobUrl) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Accepts ISO dates and ISO timestamps; anything else is dropped rather than guessed. */
function isoDay(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanText(value) ?? "");
  return match && isIsoDate(match[1]!) ? match[1]! : null;
}

/**
 * Validate the payload shape and coerce values into the tracker's limits.
 * Returns null when the message is not a capture payload at all.
 */
export function normalizeCapturedPosting(input: unknown): CapturedPosting | null {
  const parsed = capturedPostingPayloadSchema.safeParse(input);
  if (!parsed.success) return null;
  const p = parsed.data;
  const pageUrl = httpUrl(p.pageUrl);
  return {
    pageUrl: pageUrl ?? "",
    extractor: p.extractor,
    error: oneLine(p.error, 500),
    company: oneLine(p.company, CAPTURE_LIMITS.company),
    title: oneLine(p.title, CAPTURE_LIMITS.title),
    jobUrl: httpUrl(p.jobUrl) ?? pageUrl,
    externalJobId: oneLine(p.externalJobId, CAPTURE_LIMITS.externalJobId),
    location: oneLine(p.location, CAPTURE_LIMITS.location),
    workArrangement:
      p.workArrangement && p.workArrangement !== "UNKNOWN" ? p.workArrangement : null,
    description: multiLine(p.description, CAPTURE_LIMITS.description),
    datePosted: isoDay(p.datePosted),
    source: oneLine(p.source, CAPTURE_LIMITS.source),
    guessed: [...new Set(p.guessed ?? [])],
  };
}
