import { inferBoardFromUrl, parseWorkdayIdentifier } from "@jword/core/browser";
import { arrangementFrom, blockText, textOf, titleFromSlug } from "../text";
import type { SiteExtractor } from "../types";

function field(doc: Document, id: string): string | null {
  // Workday renders label/value pairs as <dl><dt>label</dt><dd>value</dd></dl>.
  return (
    textOf(doc, `[data-automation-id="${id}"] dd`) ??
    textOf(doc, `[data-automation-id="${id}"]`)?.replace(/^[^:]*:\s*/, "") ??
    null
  );
}

/**
 * {tenant}.wd{N}.myworkdayjobs.com/... Workday's JSON-LD hiringOrganization is a legal-entity
 * string such as "2100 NVIDIA USA", so the company is taken from the tenant subdomain and flagged
 * as a guess for review.
 */
export const workday: SiteExtractor = {
  name: "workday",
  source: "Workday",
  matches: (url) => /\.myworkday(jobs|site)\.com$/.test(url.hostname),
  extract(doc, url) {
    const board = inferBoardFromUrl(url.href);
    const tenant =
      board?.provider === "WORKDAY" ? parseWorkdayIdentifier(board.boardIdentifier)?.account : null;
    const location = field(doc, "locations");
    const remoteType = field(doc, "remoteType");
    const requisition = field(doc, "requisitionId")?.replace(/^job requisition id\s*/i, "");
    const fromUrl = /_([A-Za-z0-9-]+)(?:-\d+)?$/.exec(url.pathname)?.[1] ?? null;
    return {
      title: textOf(doc, '[data-automation-id="jobPostingHeader"]', "h1, h2"),
      company: tenant ? titleFromSlug(tenant) : null,
      guessed: tenant ? ["company"] : [],
      location,
      workArrangement: arrangementFrom(remoteType) ?? arrangementFrom(location),
      description: blockText(doc, '[data-automation-id="jobPostingDescription"]'),
      externalJobId: requisition || fromUrl,
    };
  },
};
