import { htmlToText } from "./text";
import type { Extraction } from "./types";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function isJobPosting(node: Json): boolean {
  return asArray(node["@type"]).some((t) => t === "JobPosting");
}

/** All schema.org JobPosting objects on the page, including inside arrays and @graph. */
export function findJobPostings(doc: Document): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown) => {
    for (const item of asArray(node)) {
      if (!isObject(item)) continue;
      if (isJobPosting(item)) found.push(item);
      if (item["@graph"]) visit(item["@graph"]);
    }
  };
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // Malformed JSON-LD is common; ignore it and fall back to other sources.
    }
  }
  return found;
}

function placeText(place: unknown): string | null {
  if (!isObject(place)) return str(place);
  const address = isObject(place.address) ? place.address : null;
  if (!address) return str(place.name);
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map(str)
    .filter((part): part is string => Boolean(part));
  // Drop repeated parts, e.g. locality "London, United Kingdom" plus country "United Kingdom".
  const unique = parts.filter(
    (part, index) => !parts.slice(0, index).some((earlier) => earlier.includes(part)),
  );
  return unique.join(", ") || str(place.name);
}

export function extractFromJsonLd(doc: Document): Extraction {
  const posting = findJobPostings(doc)[0];
  if (!posting) return {};
  const org = asArray(posting.hiringOrganization)[0];
  const locations = asArray(posting.jobLocation)
    .map(placeText)
    .filter((text): text is string => Boolean(text));
  const remote = asArray(posting.jobLocationType).some((t) => str(t) === "TELECOMMUTE");
  const identifier = asArray(posting.identifier)[0];
  const description = str(posting.description);
  return {
    title: str(posting.title),
    company: isObject(org) ? str(org.name) : str(org),
    location: locations.length
      ? [...new Set(locations)].slice(0, 3).join("; ")
      : remote
        ? "Remote"
        : null,
    workArrangement: remote ? "REMOTE" : null,
    description: description ? htmlToText(description, doc) : null,
    datePosted: str(posting.datePosted),
    externalJobId: isObject(identifier) ? str(identifier.value) : str(identifier),
    jobUrl: str(posting.url),
  };
}
