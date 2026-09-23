import { arrangementFrom, blockText, textOf, titleFromSlug } from "../text";
import type { SiteExtractor } from "../types";

/** job-boards.greenhouse.io (current) and boards.greenhouse.io (legacy) hosted boards. */
export const greenhouse: SiteExtractor = {
  name: "greenhouse",
  source: "Greenhouse",
  matches: (url) => /(^|\.)greenhouse\.io$/.test(url.hostname),
  extract(doc, url) {
    const [, slug, , jobId] = url.pathname.split("/");
    // <title>Job Application for {title} at {company}</title>
    const fromTitle = / at (.+)$/.exec(doc.title.trim())?.[1]?.trim() ?? null;
    const legacyCompany = textOf(doc, ".company-name")?.replace(/^at\s+/i, "") ?? null;
    const company = fromTitle ?? legacyCompany;
    const location = textOf(doc, ".job__location", "#header .location", ".location");
    return {
      title: textOf(doc, ".job__title h1", ".app-title", "h1"),
      company: company ?? titleFromSlug(slug),
      guessed: company ? [] : ["company"],
      location,
      workArrangement: arrangementFrom(location),
      description: blockText(doc, ".job__description", "#content"),
      externalJobId: /^\d+$/.test(jobId ?? "") ? jobId : url.searchParams.get("gh_jid"),
    };
  },
};
