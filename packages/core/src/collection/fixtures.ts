import type { SupportedBoardProvider } from "../watchlist/boards";
import type { CollectedPosting, CollectionResult, JobCollector } from "./types";

type Boards = Partial<
  Record<SupportedBoardProvider, Record<string, CollectionResult | (() => CollectionResult)>>
>;

/**
 * A collector answering from a fixed table keyed by lowercased identifier; unknown boards are
 * missing. A function entry is evaluated per call, so tests can change a board between scans.
 */
export function createFixtureJobCollector(boards: Boards): JobCollector & {
  calls: Array<{ provider: SupportedBoardProvider; identifier: string }>;
} {
  const calls: Array<{ provider: SupportedBoardProvider; identifier: string }> = [];
  return {
    calls,
    async collect(provider, identifier) {
      calls.push({ provider, identifier });
      const entry = boards[provider]?.[identifier.toLowerCase()];
      if (!entry)
        return { status: "failed", reason: "BOARD_NOT_FOUND", postings: [], reportedTotal: null };
      return structuredClone(typeof entry === "function" ? entry() : entry);
    },
  };
}

export function fixturePosting(
  base: string,
  id: string,
  title: string,
  extra: Partial<CollectedPosting> = {},
): CollectedPosting {
  return {
    postingId: id,
    title,
    location: "Remote",
    jobUrl: `${base}/${id}`,
    description: `${title} description`,
    postedOn: null,
    ...extra,
  };
}

const complete = (postings: CollectedPosting[]): CollectionResult => ({
  status: "complete",
  reason: null,
  postings,
  reportedTotal: null,
});

/**
 * Deterministic postings for browser tests (JWORD_BOARD_DIRECTORY=fixtures), matching
 * E2E_FIXTURE_BOARDS: Stripe on Greenhouse and Ramp on Ashby are complete; the Acme Workday
 * board is at Workday's reporting cap, so its scan is partial.
 */
export const E2E_FIXTURE_POSTINGS: Boards = {
  GREENHOUSE: {
    stripe: complete([
      fixturePosting("https://job-boards.greenhouse.io/stripe/jobs", "1001", "Backend Engineer", {
        location: "San Francisco, CA",
        postedOn: "2026-09-20",
      }),
      fixturePosting("https://job-boards.greenhouse.io/stripe/jobs", "1002", "Account Executive", {
        location: "New York, NY",
      }),
    ]),
  },
  LEVER: {
    stripe: complete([
      fixturePosting("https://jobs.lever.co/stripe", "a1b2", "Solutions Architect"),
    ]),
  },
  ASHBY: {
    ramp: complete([
      fixturePosting("https://jobs.ashbyhq.com/ramp", "r-1", "Software Engineer, Backend"),
    ]),
  },
  WORKDAY: {
    "acme/wd5/external": {
      status: "partial",
      reason: "TOTAL_CAPPED",
      reportedTotal: 2000,
      postings: [
        fixturePosting(
          "https://acme.wd5.myworkdayjobs.com/External",
          "/job/Austin/Firmware-Engineer_JR1",
          "Firmware Engineer",
          { description: null },
        ),
      ],
    },
  },
};
