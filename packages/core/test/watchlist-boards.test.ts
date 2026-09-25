import { describe, expect, it } from "vitest";
import {
  canonicalBoardUrl,
  inferBoardFromUrl,
  isValidBoardIdentifier,
} from "../src/watchlist/boards";

describe("inferBoardFromUrl", () => {
  const cases: Array<[string, string, string, string]> = [
    // input, provider, identifier, canonical URL
    [
      "https://boards.greenhouse.io/stripe",
      "GREENHOUSE",
      "stripe",
      "https://job-boards.greenhouse.io/stripe",
    ],
    [
      "https://boards.greenhouse.io/stripe/jobs/6523462?gh_jid=6523462",
      "GREENHOUSE",
      "stripe",
      "https://job-boards.greenhouse.io/stripe",
    ],
    [
      "https://job-boards.greenhouse.io/anthropic/jobs/4020305008#app",
      "GREENHOUSE",
      "anthropic",
      "https://job-boards.greenhouse.io/anthropic",
    ],
    [
      "https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true",
      "GREENHOUSE",
      "datadog",
      "https://job-boards.greenhouse.io/datadog",
    ],
    ["https://jobs.lever.co/netflix", "LEVER", "netflix", "https://jobs.lever.co/netflix"],
    [
      "https://jobs.lever.co/palantir/3f7e1c2a-7d7e-4d4e-9d53-0e4b5e7f1a2b/apply?lever-source=x",
      "LEVER",
      "palantir",
      "https://jobs.lever.co/palantir",
    ],
    ["https://jobs.ashbyhq.com/Ramp", "ASHBY", "Ramp", "https://jobs.ashbyhq.com/Ramp"],
    [
      "https://jobs.ashbyhq.com/openai/6f0e7a9e-2b41-4f8e-9c7e-2c3c7f0a9e11/application",
      "ASHBY",
      "openai",
      "https://jobs.ashbyhq.com/openai",
    ],
    // Pasted without a scheme, with surrounding space, uppercase host, trailing dot host.
    ["  jobs.lever.co/acme-co  ", "LEVER", "acme-co", "https://jobs.lever.co/acme-co"],
    ["HTTPS://JOBS.ASHBYHQ.COM/linear", "ASHBY", "linear", "https://jobs.ashbyhq.com/linear"],
    [
      "http://boards.greenhouse.io./figma",
      "GREENHOUSE",
      "figma",
      "https://job-boards.greenhouse.io/figma",
    ],
  ];
  for (const [input, provider, identifier, boardUrl] of cases) {
    it(`recognizes ${input.trim()}`, () => {
      expect(inferBoardFromUrl(input)).toEqual({ provider, boardIdentifier: identifier, boardUrl });
    });
  }

  const rejects = [
    "",
    "   ",
    "not a url at all",
    "https://example.com/careers",
    "https://www.greenhouse.io/stripe",
    "https://greenhouse.io.evil.com/stripe",
    "https://boards.greenhouse.io/",
    "https://boards.greenhouse.io/embed/job_board?for=stripe",
    "https://boards-api.greenhouse.io/v1/stripe",
    "https://jobs.lever.co/",
    "https://jobs.ashbyhq.com",
    "https://jobs.ashbyhq.com/The%20Browser%20Company",
    "https://jobs.lever.co/-leading-dash",
    "ftp://jobs.lever.co/netflix",
    "javascript:alert(1)",
    "https://jobs.lever.co/%E0%A4%A",
    "https://linkedin.com/jobs/view/123",
  ];
  for (const input of rejects) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(inferBoardFromUrl(input)).toBeNull();
    });
  }
});

describe("board identifiers", () => {
  it("accepts board-style names and rejects others", () => {
    for (const ok of ["stripe", "acme-co", "Ramp", "a", "board_1.v2"]) {
      expect(isValidBoardIdentifier("LEVER", ok), ok).toBe(true);
    }
    for (const bad of ["", "-x", ".x", "has space", "slash/inside", "a".repeat(101), "émoji"]) {
      expect(isValidBoardIdentifier("LEVER", bad), bad).toBe(false);
    }
  });

  it("builds the canonical board URL per provider", () => {
    expect(canonicalBoardUrl("GREENHOUSE", "x")).toBe("https://job-boards.greenhouse.io/x");
    expect(canonicalBoardUrl("LEVER", "x")).toBe("https://jobs.lever.co/x");
    expect(canonicalBoardUrl("ASHBY", "x")).toBe("https://jobs.ashbyhq.com/x");
  });
});
