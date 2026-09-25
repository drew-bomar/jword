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
  // Workday (decision 022): account/cluster/site with provider-specific rules.
  {
    name: "Workday board",
    boards: [{ provider: "WORKDAY", boardIdentifier: "contract/wd5/External_Careers" }],
    valid: true,
  },
  {
    name: "Workday alongside a name-based board",
    boards: [
      { provider: "WORKDAY", boardIdentifier: "contract-two/wd103/Careers" },
      { provider: "GREENHOUSE", boardIdentifier: "contract-two" },
    ],
    valid: true,
  },
  {
    name: "Workday name-style identifier",
    boards: [{ provider: "WORKDAY", boardIdentifier: "contract" }],
    valid: false,
  },
  {
    name: "Workday uppercase account",
    boards: [{ provider: "WORKDAY", boardIdentifier: "Contract/wd5/External" }],
    valid: false,
  },
  {
    name: "Workday bad cluster",
    boards: [{ provider: "WORKDAY", boardIdentifier: "contract/wdx/External" }],
    valid: false,
  },
  {
    name: "Workday extra path segment",
    boards: [{ provider: "WORKDAY", boardIdentifier: "contract/wd5/External/job" }],
    valid: false,
  },
  {
    name: "Workday account not a DNS label",
    boards: [{ provider: "WORKDAY", boardIdentifier: "contract_x/wd5/External" }],
    valid: false,
  },
  {
    name: "Workday site too long",
    boards: [{ provider: "WORKDAY", boardIdentifier: `contract/wd5/${"s".repeat(101)}` }],
    valid: false,
  },
  {
    name: "Workday identifier on a name-based provider",
    boards: [{ provider: "LEVER", boardIdentifier: "contract/wd5/External" }],
    valid: false,
  },
  {
    name: "Workday explicit derived URL",
    boards: [
      {
        provider: "WORKDAY",
        boardIdentifier: "contract/wd5/External",
        boardUrl: "https://contract.wd5.myworkdayjobs.com/External",
      },
    ],
    valid: false,
  },
  {
    name: "Workday duplicate ignoring site case",
    boards: [
      { provider: "WORKDAY", boardIdentifier: "contract/wd5/External" },
      { provider: "WORKDAY", boardIdentifier: "contract/wd5/EXTERNAL" },
    ],
    valid: false,
  },
  {
    name: "Workday canonical URL repeated as a careers page",
    boards: [
      { provider: "WORKDAY", boardIdentifier: "contract/wd5/External" },
      { provider: "OTHER", boardUrl: "https://contract.wd5.myworkdayjobs.com/External" },
    ],
    valid: false,
  },
];
