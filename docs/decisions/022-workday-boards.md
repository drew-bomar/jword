# 022 - Workday boards: recognized and checked, never guessed

Status: Accepted by the owner on 2026-09-24 (Workday plan review: pasted links should be checked,
myworkdaysite.com boards may be stored under myworkdayjobs.com, Workday belongs to board
discovery). Amends [decision 019](019-board-discovery.md) and [decision 018](018-company-watchlist.md)
for the provider list and identifier rules. No postings are fetched for storage and nothing is
scheduled; SmartRecruiters, Workable, careers-page scanning, and job collection stay out.

Follow-up: [decision 023](023-watch-capture-and-board-verification.md) adds direct website-field
links, extension watch capture, verification-only probes, and explicit legacy-link upgrades.

## Context

Many large employers post on Workday, which decision 019 deferred. A Workday board is not
named by one word like `stripe`: it lives at a tenant-specific host and a site name, for example
`https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite`. Neither part can be
derived from a company name, and the host differs per company, so the fixed-host rule of
decision 019 needs a provider-specific replacement.

## Decision

### Identity: one stored identifier, parsed in code

- `ats_provider` gains `WORKDAY`. A Workday board stores
  `board_identifier = {account}/{cluster}/{site}`, e.g. `nvidia/wd5/NVIDIAExternalCareerSite`.
  No new columns.
- Rules, identical in TypeScript (`WORKDAY_IDENTIFIER_PATTERN`, `parseWorkdayIdentifier`) and SQL
  (`jword.canonical_board_url`):
  - `account`: a lowercase DNS label, `[a-z0-9]`, inner `-`, at most 63 characters.
  - `cluster`: `wd` plus 1-3 digits, lowercase.
  - `site`: `[A-Za-z0-9][A-Za-z0-9_-]{0,99}`, case kept for display.
- Canonical URL: `https://{account}.{cluster}.myworkdayjobs.com/{site}`, derived only from the
  validated parts, never copied from input.
- Uniqueness stays `(user_id, provider, lower(board_identifier))`. Workday matched site names
  case-insensitively in a live check, so `…/External` and `…/EXTERNAL` are one board.
- Greenhouse, Lever, and Ashby keep their existing single-name pattern. Each provider's rule is
  checked per provider: a Workday identifier is invalid for Lever and vice versa.

### Supported URL families

`inferBoardFromUrl` recognizes exactly these, ignoring job paths, queries, and fragments:

| Family        | Shape                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| myworkdayjobs | `{account}.{wdN}.myworkdayjobs.com/[{locale}/]{site}[/job/…\|/details/…]` |
| myworkdaysite | `{wdN}.myworkdaysite.com/[{locale}/]recruiting/{account}/{site}[/…]`      |

`{locale}` is `xx-XX` (`en-US`, `fr-CA`); a locale alone is not a board. Both families are
stored under the myworkdayjobs.com identity (the owner accepted this; NVIDIA served identical
data on both on 2026-09-24). Not recognized, kept as careers pages instead: company domains that
front Workday, `*.myworkday.com` (employee sign-in), `*.myworkdayjobs-impl.com` (test tenants),
`/wday/cxs/…` data-API URLs, and hosts without a `wdN` cluster.

### Discovery: supported is not the same as guessable

- `SUPPORTED_BOARD_PROVIDERS` (storable, checkable) now includes `WORKDAY`.
  `NAME_DISCOVERY_PROVIDERS` (tried with names built from the company name) stays Greenhouse,
  Lever, and Ashby. Workday enters only through saved application links and supplied links.
- Discovery accepts `boardUrls`: up to three board links the owner supplied. The web board
  picker sends the boards currently selected, including one just pasted; the MCP tool passes
  links the user gave. They are checked first, count toward the same 15-probe budget, and
  appear with `requested: true` even when missing. This applies to every provider, so a pasted
  Greenhouse link is now checked too. Links that are not a recognized board are never fetched.
- Workday shows no company name, so ranking uses its evidence like other nameless boards:
  high when a saved application links to it, medium when the account equals the company's
  simplified name, otherwise low.

### The Workday check

- `POST https://{account}.{cluster}.myworkdayjobs.com/wday/cxs/{account}/{site}/jobs` with
  `{"appliedFacets":{},"limit":3,"offset":0,"searchText":""}` (about 16 KB). **Undocumented:**
  it is the endpoint Workday's own career pages call. Treat it as a website dependency that
  can change without notice.
- `total` is a reported count from the first page only (later pages report 0). Workday
  appears to cap it at 2000: NVIDIA reported exactly 2000, Salesforce 1531. A total at the cap
  is shown as `2000+` (`openJobsAtLeast`). Nothing about completeness is claimed.
- Only HTTP 404 means missing. 422 (for example a wrong cluster), other errors, invalid JSON,
  or a failed schema are unverified, never "absent".
- Existing limits apply unchanged: redirects refused, 6-second per-board budget, 12-second
  discovery budget, 5 MB response cap, cancellation, shared five-minute evidence cache,
  partial-failure reporting. The host is always under `.myworkdayjobs.com` because it is
  built from validated parts; an invalid identifier is never requested.

### Database

- `20260924000200_workday_provider.sql` adds the enum value on its own: Postgres cannot use a
  new enum value in the transaction that adds it.
- `20260924000300_workday_boards.sql` adds `jword.canonical_board_url(provider, identifier)`
  (immutable; null when the identifier is invalid for the provider) and rebuilds the
  `company_watch_boards_shape` check, `resolve_board_url`, `provider_label`, and the command
  shape in `validate_watch_command` on it. Existing rows are revalidated by the new check.

## Why not other approaches

- **Separate account/cluster/site columns.** Every other layer treats a board as provider +
  identifier; three nullable columns would spread Workday special cases through reads, audit
  metadata, and uniqueness. Parsing one identifier in one place is smaller.
- **Relaxing the shared pattern to allow slashes.** URL builders would then accept `a/b/c`
  for Lever too, and nothing would guarantee the Workday host stays under myworkdayjobs.com.
- **Guessing Workday from the company name.** The cluster (`wd1`…`wd103`) and site name are
  arbitrary; guessing would multiply requests to tenant hosts with little chance of success.

## Tradeoffs

- One company's successful check does not establish reliability across tenants. Some tenants
  may block automated reads, change the endpoint, or require a different cluster.
- Storing myworkdaysite.com boards under myworkdayjobs.com assumes both serve the same board.
  The check verifies the stored identity, so a mismatch would show as missing or unverified.
- Always checking selected boards spends up to three of the 15 probes, which can trim name
  guesses for long company names (reported as a warning).

## Verification

Unit tests cover both URL families, locale prefixes, postings, queries, case, and malformed
hosts; per-provider validation; the Workday check against a fake network (request shape,
redirect refusal, capped totals, 404 vs 422/500/bad JSON/timeouts, invalid identifiers never
requested); that discovery never guesses Workday; supplied links checked first and careers pages
never fetched; and the MCP tool. The shared contract corpus now includes Workday and runs
against Zod and the real SQL. A database test compares `jword.canonical_board_url` with the
TypeScript builder for every provider and checks the table constraint directly. Playwright
covers pasting a Workday posting link. A live check on 2026-09-24 found NVIDIA (2000+),
Salesforce (1531), and reported a non-existent NVIDIA site as missing.
