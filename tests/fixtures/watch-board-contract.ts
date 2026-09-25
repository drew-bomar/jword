/** One input corpus exercised by both Zod and the real public SQL wrapper. */
export const watchBoardContract: Array<{ name: string; boards: unknown; valid: boolean }> = [
  { name: "no boards", boards: [], valid: true },
  {
    name: "canonical supported board",
    boards: [{ provider: "LEVER", boardIdentifier: "contract-one" }],
    valid: true,
  },
  {
    name: "careers page",
    boards: [{ provider: "OTHER", boardUrl: "https://example.com/careers" }],
    valid: true,
  },
  {
    name: "three providers",
    boards: ["GREENHOUSE", "LEVER", "ASHBY"].map((provider) => ({
      provider,
      boardIdentifier: "contract-three",
    })),
    valid: true,
  },
  {
    name: "four boards",
    boards: ["a", "b", "c", "d"].map((boardIdentifier) => ({ provider: "ASHBY", boardIdentifier })),
    valid: false,
  },
  {
    name: "duplicate identity ignoring case",
    boards: [
      { provider: "LEVER", boardIdentifier: "dup" },
      { provider: "LEVER", boardIdentifier: "DUP" },
    ],
    valid: false,
  },
  {
    name: "duplicate canonical URL across providers",
    boards: [
      { provider: "LEVER", boardIdentifier: "dup" },
      { provider: "OTHER", boardUrl: "https://jobs.lever.co/dup" },
    ],
    valid: false,
  },
  {
    name: "explicit derived URL",
    boards: [
      {
        provider: "ASHBY",
        boardIdentifier: "derived",
        boardUrl: "https://jobs.ashbyhq.com/derived",
      },
    ],
    valid: false,
  },
  { name: "missing careers URL", boards: [{ provider: "OTHER" }], valid: false },
  {
    name: "identifier on OTHER",
    boards: [{ provider: "OTHER", boardIdentifier: "x", boardUrl: "https://example.com/jobs" }],
    valid: false,
  },
  {
    name: "invalid identifier",
    boards: [{ provider: "LEVER", boardIdentifier: "../x" }],
    valid: false,
  },
  {
    name: "identifier too long",
    boards: [{ provider: "GREENHOUSE", boardIdentifier: "x".repeat(101) }],
    valid: false,
  },
  {
    name: "non-HTTP URL",
    boards: [{ provider: "OTHER", boardUrl: "javascript:alert(1)" }],
    valid: false,
  },
  {
    name: "unknown field",
    boards: [{ provider: "LEVER", boardIdentifier: "x", extra: "y" }],
    valid: false,
  },
  { name: "wrong type", boards: "LEVER", valid: false },
];
