import type { SupportedBoardProvider } from "../watchlist/boards";
import type { BoardDirectory, ProbeOutcome } from "./types";

type Boards = Partial<Record<SupportedBoardProvider, Record<string, ProbeOutcome>>>;

/** A board directory answering from a fixed table; unknown boards are missing. For tests. */
export function createFixtureBoardDirectory(boards: Boards): BoardDirectory & {
  calls: Array<{ provider: SupportedBoardProvider; identifier: string }>;
} {
  const calls: Array<{ provider: SupportedBoardProvider; identifier: string }> = [];
  return {
    calls,
    async probe(provider, identifier) {
      calls.push({ provider, identifier });
      return boards[provider]?.[identifier.toLowerCase()] ?? { status: "missing" };
    },
  };
}

const found = (
  boardName: string | null,
  openJobs: number,
  sampleTitles: string[],
  website: string | null = null,
  openJobsAtLeast = false,
): ProbeOutcome => ({
  status: "found",
  boardName,
  website,
  openJobs,
  openJobsAtLeast,
  sampleTitles,
});

/**
 * Deterministic boards for browser tests (JWORD_BOARD_DIRECTORY=fixtures), so Playwright
 * never calls the real providers. "Stripe" and "Ramp" have strong matches; "notion" on Lever
 * is a same-name board belonging to someone else. The Workday board is reached only through
 * a pasted or saved link, and reports a capped total.
 */
export const E2E_FIXTURE_BOARDS: Boards = {
  GREENHOUSE: {
    stripe: found("Stripe", 689, ["Backend Engineer", "Account Executive"]),
  },
  LEVER: {
    stripe: found("Stripe", 3, ["Solutions Architect"]),
    notion: found("Notion Hardware Co.", 2, ["Firmware Engineer"]),
  },
  ASHBY: {
    ramp: found("Ramp", 120, ["Software Engineer, Backend"], "https://ramp.com"),
    notion: found("Notion", 88, ["Product Engineer"], "https://www.notion.so"),
  },
  WORKDAY: {
    "acme/wd5/external": found(
      null,
      2000,
      ["Silicon Validation Engineer", "Firmware Engineer"],
      null,
      true,
    ),
  },
};
