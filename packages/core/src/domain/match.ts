import type { ApplicationSummary, Page } from "./types";

export type MatchResolution =
  | { kind: "none" }
  | { kind: "unique"; match: ApplicationSummary }
  | { kind: "ambiguous"; candidates: ApplicationSummary[]; truncated: boolean };

/**
 * The agent-side ambiguity rule, encoded once so it can be tested:
 * a mutation target is only "unique" when exactly one candidate came back AND the
 * page was complete. A truncated page with one visible candidate is not evidence.
 */
export function resolveUniqueMatch(page: Page<ApplicationSummary>): MatchResolution {
  if (page.items.length === 0) return { kind: "none" };
  if (page.items.length === 1 && !page.hasMore) return { kind: "unique", match: page.items[0]! };
  return { kind: "ambiguous", candidates: page.items, truncated: page.hasMore };
}
