import { textOf, titleFromSlug } from "../text";
import type { SiteExtractor } from "../types";

/** jobs.ashbyhq.com/{company}/{postingId}. Ashby publishes complete JSON-LD; DOM is a fallback. */
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
    };
  },
};
