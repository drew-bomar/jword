import { hostOf, simplifyCompanyName } from "./candidates";
import type { BoardConfidence, ProbeOutcome } from "./types";

export interface BoardEvidence {
  company: string;
  companyWebsite: string | null;
  boardIdentifier: string;
  /** Board names generated from the company name, most specific first. */
  candidates: string[];
  fromApplications: boolean;
  outcome: ProbeOutcome;
}

/**
 * How sure jword is that a board belongs to this company, and why, in owner-readable words.
 * High: a saved application links to it, the board's own name matches, or its website matches.
 * Medium: the name overlaps, or no name is available but the board has the company's exact name.
 * Low: the board exists but names something else, or it no longer exists.
 */
export function rateBoard(evidence: BoardEvidence): {
  confidence: BoardConfidence;
  reasons: string[];
} {
  const reasons: string[] = [];
  let confidence: BoardConfidence = "low";
  const raise = (to: BoardConfidence) => {
    const order = { low: 0, medium: 1, high: 2 };
    if (order[to] > order[confidence]) confidence = to;
  };

  if (evidence.fromApplications) {
    reasons.push("Linked from your saved applications");
    raise("high");
  }
  const { outcome } = evidence;
  if (outcome.status === "missing") {
    reasons.push("The board no longer exists");
    return { confidence: "low", reasons };
  }
  if (outcome.status === "error") {
    reasons.push("Could not reach the provider to check it");
    return { confidence, reasons };
  }

  const wanted = simplifyCompanyName(evidence.company);
  if (outcome.boardName) {
    const shown = simplifyCompanyName(outcome.boardName);
    if (shown && shown === wanted) {
      reasons.push(`Board name “${outcome.boardName}” matches`);
      raise("high");
    } else if (shown && wanted && (shown.includes(wanted) || wanted.includes(shown))) {
      reasons.push(`Board name “${outcome.boardName}” is similar`);
      raise("medium");
    } else {
      reasons.push(`Board name “${outcome.boardName}” differs`);
    }
  } else if (evidence.boardIdentifier.toLowerCase() === evidence.candidates[0]) {
    reasons.push("Board name matches the company name exactly");
    raise("medium");
  } else {
    reasons.push("The board does not show a company name");
  }

  const boardHost = hostOf(outcome.website);
  const companyHost = hostOf(evidence.companyWebsite);
  if (boardHost && companyHost && boardHost === companyHost) {
    reasons.push(`Website ${boardHost} matches`);
    raise("high");
  }
  if (outcome.openJobs === 0) reasons.push("No open jobs right now");
  return { confidence, reasons };
}
