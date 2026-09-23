import type { CapturedPostingPayload } from "@jword/core/browser";
import { extractFromJsonLd } from "./jsonld";
import { ashby } from "./sites/ashby";
import { greenhouse } from "./sites/greenhouse";
import { lever } from "./sites/lever";
import { linkedin } from "./sites/linkedin";
import { workday } from "./sites/workday";
import { metaContent, textOf } from "./text";
import type { Extraction, GuessableField, SiteExtractor } from "./types";

/** Ordered site adapters. The first whose `matches` accepts the URL is used. */
export const SITE_EXTRACTORS: SiteExtractor[] = [linkedin, greenhouse, lever, ashby, workday];

/**
 * Fields a site adapter knows better than the page's JSON-LD. Workday's JSON-LD company is a
 * legal entity ("2100 NVIDIA USA"), so its tenant-derived name is kept even though it is a guess.
 */
const PREFER_SITE: Record<string, Array<keyof Extraction>> = { workday: ["company"] };

/** Last-resort values from standard meta tags; titles and company names here are guesses. */
function extractFromMeta(doc: Document, url: URL): Extraction {
  const siteName = metaContent(doc, "og:site_name");
  const title = metaContent(doc, "og:title") ?? textOf(doc, "h1") ?? (doc.title.trim() || null);
  const canonical =
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? metaContent(doc, "og:url");
  return {
    title,
    company: siteName,
    guessed: [...(title ? ["title" as const] : []), ...(siteName ? ["company" as const] : [])],
    jobUrl: canonical ? new URL(canonical, url).toString() : null,
    // Company career pages often embed a Greenhouse board and carry its id in the URL.
    externalJobId: url.searchParams.get("gh_jid"),
  };
}

const TRACKING_PARAMS =
  /^(utm_.*|gh_src|lever-source|lever-origin|ref|refid|trk|trackingid|src|source|sourcetype|mode)$/i;

/** Drop tracking parameters so the same posting yields the same URL for duplicate matching. */
export function cleanJobUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type MergeField = Exclude<keyof Extraction, "guessed">;
const MERGE_FIELDS: MergeField[] = [
  "company",
  "title",
  "jobUrl",
  "externalJobId",
  "location",
  "workArrangement",
  "description",
  "datePosted",
];

/**
 * Per field, take the first confident value in source order; a guessed value is used only
 * when no source is confident, and the field stays flagged for review.
 */
export function mergeExtractions(sources: Extraction[]): Extraction {
  const merged: Extraction = { guessed: [] };
  for (const field of MERGE_FIELDS) {
    let guess: { value: unknown } | null = null;
    for (const source of sources) {
      const value = source[field];
      if (value === null || value === undefined || value === "") continue;
      if (source.guessed?.includes(field as GuessableField)) {
        guess ??= { value };
        continue;
      }
      (merged as Record<string, unknown>)[field] = value;
      guess = null;
      break;
    }
    if (guess) {
      (merged as Record<string, unknown>)[field] = guess.value;
      merged.guessed!.push(field as GuessableField);
    }
  }
  return merged;
}

export function extractPosting(doc: Document, pageUrl: string): CapturedPostingPayload {
  const url = new URL(pageUrl);
  const site = SITE_EXTRACTORS.find((candidate) => candidate.matches(url));
  const fromSite = site ? site.extract(doc, url) : {};
  // On a known job board the page URL identifies the posting; canonical tags there are
  // sometimes downgraded to http:// or point at a different board layout.
  if (site && !fromSite.jobUrl) fromSite.jobUrl = url.toString();
  const fromJsonLd = extractFromJsonLd(doc);
  for (const field of PREFER_SITE[site?.name ?? ""] ?? []) {
    if (fromSite[field]) delete fromJsonLd[field];
  }
  const merged = mergeExtractions([
    // A site adapter's guesses are weaker than JSON-LD but stronger than meta tags.
    fromSite,
    fromJsonLd,
    extractFromMeta(doc, url),
  ]);
  return {
    version: 1,
    pageUrl: url.toString(),
    extractor: site?.name ?? (Object.keys(fromJsonLd).length ? "jsonld" : "generic"),
    company: merged.company ?? null,
    title: merged.title ?? null,
    jobUrl: cleanJobUrl(merged.jobUrl) ?? cleanJobUrl(url.toString()),
    externalJobId: merged.externalJobId ?? null,
    location: merged.location ?? null,
    workArrangement: merged.workArrangement ?? null,
    description: merged.description ?? null,
    datePosted: merged.datePosted ?? null,
    source: site?.source ?? url.hostname.replace(/^www\./, ""),
    guessed: merged.guessed ?? [],
  };
}
