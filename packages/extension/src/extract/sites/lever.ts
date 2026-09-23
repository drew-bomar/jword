import { arrangementFrom, blockText, textOf, titleFromSlug } from "../text";
import type { SiteExtractor } from "../types";

/** jobs.lever.co/{company}/{postingId}. Company comes from JSON-LD when present. */
export const lever: SiteExtractor = {
  name: "lever",
  source: "Lever",
  matches: (url) => url.hostname === "jobs.lever.co" || url.hostname === "jobs.eu.lever.co",
  extract(doc, url) {
    const [, slug, postingId] = url.pathname.split("/");
    const workplace = textOf(doc, ".posting-categories .workplaceTypes");
    const location = textOf(doc, ".posting-categories .location");
    return {
      title: textOf(doc, ".posting-headline h2", ".posting-headline h1"),
      // Fallback only; JSON-LD hiringOrganization wins when it exists (see mergeExtractions).
      company: titleFromSlug(slug),
      guessed: ["company"],
      location,
      workArrangement: arrangementFrom(workplace) ?? arrangementFrom(location),
      description: blockText(
        doc,
        ".section-wrapper.page-full-width:not(.accent-section) .section.page-centered:not(.last-section-apply)",
      ),
      externalJobId: postingId ?? null,
    };
  },
};
