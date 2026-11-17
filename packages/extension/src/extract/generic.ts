import { elementToText, metaContent, textOf } from "./text";
import type { Extraction } from "./types";

/** Title separators that set off a site or company name: "Engineer - Acme", "Engineer | Acme". */
const TITLE_SEPARATOR = /\s+[-|–—·]\s+/;
const CAREERS_WORDS = /^(careers?|jobs?|job details|open positions|job openings|home)$/i;

/** "Careers at Acme" / "Acme Careers" / "Acme Jobs" -> "Acme". */
function stripCareers(name: string): string {
  return name
    .replace(/^(careers|jobs)\s+(at|@)\s+/i, "")
    .replace(/\s+(careers|jobs)$/i, "")
    .trim();
}

/**
 * Company name from the trailing segment of the page title, e.g.
 * "Software Engineer - New Grad - Databricks" or "Graduate engineer | Bending Spoons".
 * Returns null when the segment looks like a generic word rather than a name.
 */
export function companyFromTitle(...titles: Array<string | null>): string | null {
  for (const title of titles) {
    const parts = title?.split(TITLE_SEPARATOR) ?? [];
    if (parts.length < 2) continue;
    const name = stripCareers(parts.at(-1)!);
    if (name && name.length <= 40 && !CAREERS_WORDS.test(name)) return name;
  }
  return null;
}

/** "Engineer - Acme" -> "Engineer" when the suffix is the company already read. */
function stripCompanySuffix(title: string, company: string | null): string {
  if (!company) return title;
  const parts = title.split(TITLE_SEPARATOR);
  return parts.length > 1 && stripCareers(parts.at(-1)!) === company
    ? title.slice(0, title.lastIndexOf(parts.at(-1)!)).replace(/\s+[-|–—·]\s*$/, "")
    : title;
}

const CONTENT_BLOCKS = "p, li, pre, blockquote, dd";
const CHROME =
  "nav, header, footer, aside, form, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=dialog]";

/**
 * The page's main body of text, for career sites without JSON-LD. Each paragraph or list item
 * credits its length to its parent and half to its grandparent (the approach readability tools
 * use), so the element that directly holds most of the prose wins over the whole page.
 * Navigation, headers, footers, and dialogs (cookie banners) are ignored.
 */
export function mainText(doc: Document): string | null {
  const scores = new Map<Element, number>();
  const credit = (el: Element | null | undefined, amount: number) => {
    if (el && el !== doc.body) scores.set(el, (scores.get(el) ?? 0) + amount);
  };
  for (const block of Array.from(doc.body?.querySelectorAll(CONTENT_BLOCKS) ?? [])) {
    if (block.closest(CHROME) || block.parentElement?.closest(CONTENT_BLOCKS)) continue;
    const length = (block.textContent ?? "").replace(/\s+/g, " ").trim().length;
    if (length < 25) continue;
    credit(block.parentElement, length);
    credit(block.parentElement?.parentElement, length / 2);
  }
  let best: Element | null = null;
  for (const [el, score] of scores) if (!best || score > scores.get(best)!) best = el;
  if (!best) return null;
  const text = elementToText(best);
  // A short winner is a blurb or a card, not a job description.
  return text.length >= 200 ? text : null;
}

/** Last-resort values for unknown career sites; titles and company names here are guesses. */
export function extractGeneric(doc: Document, url: URL): Extraction {
  const pageTitle = doc.title.trim() || null;
  const ogTitle = metaContent(doc, "og:title");
  const company = metaContent(doc, "og:site_name") ?? companyFromTitle(pageTitle, ogTitle);
  // The heading is the posting title when a page title repeats it; og:title is sometimes
  // site-wide ("Jobs at Acme").
  const heading = textOf(doc, "h1");
  const corroborated =
    heading && [pageTitle, ogTitle].some((t) => t?.includes(heading)) ? heading : null;
  const fallback = ogTitle ?? heading ?? pageTitle;
  const title = corroborated ?? (fallback ? stripCompanySuffix(fallback, company) : null);
  const canonical =
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? metaContent(doc, "og:url");
  let jobUrl = canonical ? new URL(canonical, url) : null;
  // Some sites set one site-wide og:url; a home page link is not this posting's URL.
  if (jobUrl?.pathname === "/" && url.pathname !== "/") jobUrl = null;
  return {
    title,
    company,
    guessed: [...(title ? ["title" as const] : []), ...(company ? ["company" as const] : [])],
    jobUrl: jobUrl?.toString() ?? null,
    // Company career pages often embed a Greenhouse board and carry its id in the URL.
    externalJobId: url.searchParams.get("gh_jid"),
    description: mainText(doc),
  };
}
