import { BOARD_IDENTIFIER_PATTERN } from "../watchlist/boards";

/** Words dropped from the end of a company name: legal forms. */
const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "pbc",
  "lp",
  "llp",
]);

/** Words often left out of a board name ("Palantir Technologies" → "palantir"). */
const OPTIONAL_SUFFIXES = new Set([
  "technologies",
  "technology",
  "labs",
  "lab",
  "ai",
  "hq",
  "group",
  "software",
  "systems",
  "jobs",
  "careers",
]);

export const MAX_BOARD_CANDIDATES = 5;

function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function dropTrailing(list: string[], suffixes: Set<string>): string[] {
  const out = [...list];
  while (out.length > 1 && suffixes.has(out[out.length - 1]!)) out.pop();
  return out;
}

/** "https://www.notion.so/careers" → "notion.so". Null for anything that is not a web URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return (
      parsed.hostname
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/\.$/, "") || null
    );
  } catch {
    return null;
  }
}

/**
 * Likely board names for a company, most specific first: the full name joined and hyphenated,
 * then without legal and common trailing words, then the website's domain name. Pure.
 */
export function boardNameCandidates(company: string, websiteUrl?: string | null): string[] {
  const full = dropTrailing(words(company), LEGAL_SUFFIXES);
  const core = dropTrailing(full, OPTIONAL_SUFFIXES);
  const host = hostOf(websiteUrl);
  const domainRoot = host ? host.split(".").slice(0, -1).pop() : undefined;
  const list = [full.join(""), full.join("-"), core.join(""), core.join("-"), domainRoot ?? ""];
  const unique: string[] = [];
  for (const candidate of list) {
    if (candidate.length < 2 || !BOARD_IDENTIFIER_PATTERN.test(candidate)) continue;
    if (!unique.includes(candidate)) unique.push(candidate);
  }
  return unique.slice(0, MAX_BOARD_CANDIDATES);
}

/** Company name reduced for comparison: no accents, suffixes, punctuation, or spaces. */
export function simplifyCompanyName(name: string): string {
  return dropTrailing(dropTrailing(words(name), LEGAL_SUFFIXES), OPTIONAL_SUFFIXES).join("");
}
