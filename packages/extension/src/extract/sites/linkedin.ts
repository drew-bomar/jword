import { arrangementFrom, blockText, textOf } from "../text";
import type { SiteExtractor } from "../types";

const WORKPLACE = /^(remote|hybrid|on-site|onsite)$/i;

/**
 * LinkedIn's 2026 job pages use hashed class names, so the current layout is read from things
 * that carry meaning instead: the page title ("{title} | {company} | LinkedIn"), the text lines of
 * the top card around the title, company links, and `componentkey` attributes. Older class-based
 * selectors stay as a fallback for the previous layout.
 */
function linesOf(el: HTMLElement): string[] {
  return (el.innerText ?? el.textContent ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function topCardLines(doc: Document, title: string): string[] {
  // Find the text node that is exactly the job title. The top card is its nearest `componentkey`
  // section (company, title, "Location · 2 weeks ago · …", workplace chips); without one, fall
  // back to the nearest ancestor holding the "·" line.
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() !== title) continue;
    const card = node.parentElement?.closest<HTMLElement>("[componentkey]");
    if (card && (card.textContent ?? "").length < 2000) return linesOf(card);
    let el = node.parentElement;
    for (let depth = 0; el && depth < 8; depth += 1, el = el.parentElement) {
      const lines = linesOf(el);
      if (lines.some((line) => line.includes(" · "))) return lines;
    }
  }
  return [];
}

export const linkedin: SiteExtractor = {
  name: "linkedin",
  source: "LinkedIn",
  matches: (url) => /(^|\.)linkedin\.com$/.test(url.hostname) && url.pathname.startsWith("/jobs"),
  extract(doc, url) {
    const jobId =
      /\/jobs\/view\/(?:[^/]*-)?(\d+)/.exec(url.pathname)?.[1] ??
      url.searchParams.get("currentJobId");
    const [titlePart, companyPart] = doc.title
      .replace(/^\(\d+\)\s*/, "")
      .split(" | ")
      .map((part) => part.trim());
    const legacyTop = ".job-details-jobs-unified-top-card__primary-description-container";
    const title =
      textOf(
        doc,
        ".job-details-jobs-unified-top-card__job-title h1",
        ".job-details-jobs-unified-top-card__job-title",
        ".top-card-layout__title",
      ) ?? (titlePart && titlePart !== "LinkedIn" ? titlePart : null);
    const lines = title ? topCardLines(doc, title) : [];
    const afterTitle = lines.slice(Math.max(0, lines.indexOf(title ?? "")));
    // "Atlanta, GA · 2 weeks ago · 64 people clicked apply": the first segment is the place.
    const location =
      (
        textOf(doc, `${legacyTop} .tvm__text`, legacyTop, ".topcard__flavor--bullet") ??
        afterTitle.find((line) => line.includes(" · ")) ??
        null
      )
        ?.split("·")[0]
        ?.trim() || null;
    const workplace =
      textOf(doc, ".job-details-fit-level-preferences", ".job-details-preferences-and-skills") ??
      afterTitle.find((line) => WORKPLACE.test(line)) ??
      null;
    return {
      title,
      company:
        textOf(
          doc,
          ".job-details-jobs-unified-top-card__company-name a",
          ".job-details-jobs-unified-top-card__company-name",
          ".topcard__org-name-link",
        ) ??
        (companyPart && companyPart !== "LinkedIn" ? companyPart : null) ??
        textOf(doc, 'a[href*="/company/"]'),
      location,
      workArrangement: arrangementFrom(workplace) ?? arrangementFrom(location),
      // "About the job" renders lazily; if it has not loaded yet the owner can paste it.
      description: blockText(
        doc,
        '[componentkey^="JobDetails_AboutTheJob"]',
        "#job-details",
        ".jobs-description__content",
        ".show-more-less-html__markup",
      ),
      externalJobId: jobId,
      jobUrl: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null,
    };
  },
};
