import type { WorkArrangement } from "@jword/core/browser";

/** Field names that may be flagged as guesses for the owner to review. */
export type GuessableField = "company" | "title" | "location";

/** What one extractor could read. Every field is optional; later sources fill gaps. */
export interface Extraction {
  company?: string | null;
  title?: string | null;
  jobUrl?: string | null;
  externalJobId?: string | null;
  location?: string | null;
  workArrangement?: WorkArrangement | null;
  description?: string | null;
  datePosted?: string | null;
  guessed?: GuessableField[];
}

/**
 * A site adapter. Adding a site means adding one of these and a fixture test;
 * see packages/extension/SITES.md.
 */
export interface SiteExtractor {
  /** Stable id recorded on the capture, e.g. "greenhouse". */
  name: string;
  /** Human label saved as the application's source, e.g. "Greenhouse". */
  source: string;
  matches(url: URL): boolean;
  extract(doc: Document, url: URL): Extraction;
}
