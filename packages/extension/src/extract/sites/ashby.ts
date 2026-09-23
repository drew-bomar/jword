import type { Extraction, SiteExtractor } from "../types";
import { arrangementFrom, textOf, titleFromSlug } from "../text";

/**
 * Ashby's own workplace type. Its JSON-LD is not reliable for this: a hybrid posting was seen
 * publishing `jobLocationType: TELECOMMUTE` (2026-09-22), so this value must win.
 * The rendered sidebar shows "Location Type"; the embedded app data is a fallback.
 */
function workplace(doc: Document): Extraction["workArrangement"] {
  for (const heading of doc.querySelectorAll("h2")) {
    if (heading.textContent?.trim().toLowerCase() === "location type") {
      const found = arrangementFrom(heading.nextElementSibling?.textContent);
      if (found) return found;
    }
  }
  for (const script of doc.querySelectorAll("script:not([src])")) {
    const match = /"workplaceType"\s*:\s*"(\w+)"/.exec(script.textContent ?? "");
    if (match) return arrangementFrom(match[1]);
  }
  return null;
}

/** jobs.ashbyhq.com/{company}/{postingId}. JSON-LD covers most fields; DOM is a fallback. */
export const ashby: SiteExtractor = {
  name: "ashby",
  source: "Ashby",
  matches: (url) => url.hostname === "jobs.ashbyhq.com",
  extract(doc, url) {
    const [, slug, postingId] = url.pathname.split("/");
    // <title>{title} @ {company}</title>
    const [titlePart, companyPart] = doc.title.split(" @ ").map((part) => part.trim());
    return {
      title: textOf(doc, "h1") ?? titlePart ?? null,
      company: companyPart || titleFromSlug(slug),
      guessed: companyPart ? [] : ["company"],
      externalJobId: postingId ?? null,
      workArrangement: workplace(doc),
    };
  },
};
