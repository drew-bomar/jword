import type { SupportedBoardProvider } from "../watchlist/boards";
import type { WatchBoard } from "../watchlist/types";

export type BoardConfidence = "high" | "medium" | "low";

/** What a public board API said about one provider + identifier. */
export type ProbeOutcome =
  | {
      status: "found";
      /** The company name the board itself shows, when the provider exposes one. */
      boardName: string | null;
      /** The company website the board lists (Ashby), for a domain check. */
      website: string | null;
      openJobs: number | null;
      /** True when openJobs is a lower bound (only a page of postings was read). */
      openJobsAtLeast: boolean;
      sampleTitles: string[];
    }
  | { status: "missing" }
  | { status: "error" };

/** Reads public board APIs. The real one lives in ./directory; tests use a fake. */
export interface BoardDirectory {
  probe(provider: SupportedBoardProvider, identifier: string): Promise<ProbeOutcome>;
}

/** A board jword found for a company, with the evidence for the owner to judge it. */
export interface BoardSuggestion {
  provider: SupportedBoardProvider;
  boardIdentifier: string;
  boardUrl: string;
  confidence: BoardConfidence;
  reasons: string[];
  boardName: string | null;
  openJobs: number | null;
  openJobsAtLeast: boolean;
  sampleTitles: string[];
  /** A saved application's job URL points at this board. */
  fromApplications: boolean;
  /** Already watched for a company (possibly this one). */
  watchedBy: { watchId: string; company: string } | null;
}

export interface BoardDiscoveryResult {
  company: string;
  companyId: string | null;
  /** Board names that were tried on each provider. */
  candidates: string[];
  suggestions: BoardSuggestion[];
  /** Providers that could not be reached, so a missing board there is unknown, not absent. */
  unavailable: SupportedBoardProvider[];
}

/** A company you applied to, not yet watched, with boards read from its job URLs. */
export interface ApplicationWatchSuggestion {
  companyId: string;
  company: string;
  applicationCount: number;
  boards: WatchBoard[];
}
