# 019 - Board discovery and up to three boards per company

Status: Accepted by the owner on 2026-09-23 ("outside calls are welcome, multiple boards should be
allowed but probably 3 is the max, go straight to building"). Amends
[decision 018](018-company-watchlist.md): one watch per company stays, but boards move to a child
table and are found for the owner instead of typed in.

**Amended by [decision 020](020-watchlist-reliability.md):** cancellable GET reads, total probe and
time budgets, partial-result reporting, public-evidence caching, guarded fixtures, validated Ashby
fallback, and stable IDs for retained boards. The initial implementation details below are historical.

**Amended by [decision 022](022-workday-boards.md):** Workday boards (`account/cluster/site`) are
recognized from links and checked, but never guessed from a name; discovery also checks up to
three board links the owner supplies (`boardUrls`).

## Context

With decision 018 the owner had to find each company's job-board URL by hand. The owner wants
adding a company to be enough, and noted that companies post jobs in several places.

## Decision

### Up to three boards per watched company

- New table `company_watch_boards` with `user_id`, `watch_id`, `position`, `provider`,
  `board_identifier`, and `board_url`. `position` is checked to be 1-3 and unique per watch, so
  **the database itself caps a watch at three boards**.
- The watch stays the company-level unit: active flag, version, audit, retry receipts.
  `create_company_watch` / `update_company_watch` take a `boards` array (0-3). An update
  **replaces the whole set** in the same transaction as the version bump and audit row. Audit
  metadata keeps the before/after lists.
- Board rows keep decision 018's rules: supported boards store a canonical URL derived from the
  identifier, `OTHER` is a careers page (URL required, no identifier), and one board belongs to
  one company per owner (unique on `(user_id, provider, lower(identifier))`).
- A watch may have zero boards: the company is watched, jword just has nothing to read yet.
- Migration `20260923000100_watch_boards.sql` moves existing boards over and drops
  `provider`, `board_identifier`, and `board_url` from `company_watches`. An `OTHER` watch
  without a URL ends up with no boards.

### Discovery: evidence first, network second, owner decides

`discoverCompanyBoards` in the watchlist service returns ranked suggestions and saves nothing.

1. **Saved applications (local).** Job URLs on the company's applications are parsed with
   `inferBoardFromUrl`. If you applied through a board, that board is strong evidence.
2. **Public board APIs (network).** Board names are generated from the company name and website
   (`boardNameCandidates`, at most 5). Examples: `Scale AI` → `scaleai`, `scale-ai`, `scale`;
   the domain root of the website is added too. Each name is tried on Greenhouse, Lever, and
   Ashby (at most 15 lookups, 6 at a time, 6-second timeout each).
3. **Ranking (`rateBoard`).**
   - **High:** a saved application links to the board, the board's own company name matches
     after dropping suffixes like Inc/Technologies/AI, or the board's website matches the
     company's.
   - **Medium:** the names overlap, or the provider shows no name but the board has the company's
     exact name.
   - **Low:** the board names a different company, or it no longer exists.

Each suggestion carries its reasons, open-job count, and sample titles, and says whether the
board is already watched for another company.

The web form runs discovery by itself once a company name is entered (after typing pauses)
and pre-ticks only high-confidence boards that are not taken. Medium and low boards are shown
unticked. The owner can untick anything and add boards by pasting a URL. The MCP tool returns
the same ranking; the agent protocol says to add high-confidence boards and ask about the rest.

`suggestWatchesFromApplications` lists companies you applied to but do not watch, with boards
from their saved job URLs (up to three). It uses local data only. The Watchlist page offers them
as a one-step "Suggest from applications" list, each added as its own retry-safe save.

### Which provider endpoints are called

The `BoardDirectory` in `packages/core/src/discovery/directory.ts` contacts only these fixed
hosts. The identifier is pattern-checked and URL-encoded, so input cannot redirect a request.

| Provider   | Endpoint                                                                                                    | Gives                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{id}` and `/jobs` (documented)                                          | company name, exact job count, titles       |
| Lever      | `api.lever.co/v0/postings/{id}?limit=5` (documented), first 64 KB of `jobs.lever.co/{id}` for its `<title>` | existence, "5+" jobs, titles, company name  |
| Ashby      | GraphQL behind `jobs.ashbyhq.com` (undocumented, used by Ashby's own pages)                                 | company name and website, job count, titles |

Ashby's documented posting API returns full descriptions (about 2.5 MB for one company), so the
small GraphQL queries are used instead. If Ashby changes them, lookups report the provider as
unreachable; they never fail the page. Responses are capped at 5 MB (JSON) and 64 KB (HTML).
Nothing from these calls is stored. Web requests run in the Next.js server during the owner's
session; the MCP tool runs in the local process. Browser tests use a fixture directory
(`JWORD_BOARD_DIRECTORY=fixtures`) and never call the real providers.

## Why not other approaches

- **Web search or a model** to find careers pages. It needs a paid API and the answers are
  harder to verify; AGENTS.md keeps model calls out of jword.
- **Crawling the company's website** for board links. It would find unusual board names, but it
  means fetching arbitrary owner-supplied URLs (server-side request forgery risk) and parsing
  HTML. Deferred until name-based lookup proves insufficient.
- **Auto-saving strong matches** without review. Same-name boards belong to different companies
  often enough (the Lever "notion" test case) that the owner confirms, in the spirit of decision 013.
- **Several watch rows per company** instead of a child table. That would duplicate the active
  flag, version, and audit per board, and break "one watch per company".
- **Workday, iCIMS, SmartRecruiters**. Many large companies use them, but each needs its own
  adapter and some block automated reads. They can be added as `BoardDirectory` providers later.

## Tradeoffs

- Discovery makes up to about 30 outbound HTTPS requests per lookup, only when the owner enters
  a company or clicks Find boards. No background job.
- Name guessing misses boards with unrelated names. Saved application links and "Add a board
  by URL" cover those.
- Replacing the board set on update deletes and re-inserts configuration rows. The audit row
  keeps the before/after lists, so history is not lost. There is still no user-facing delete of
  companies, watches, or history.

## Verification

Unit tests cover candidates, ranking, all three provider adapters against a fake `fetch`
(found, missing, server errors, bad JSON, invalid names never requested), and both services with
a fixture directory. Integration tests cover the board table's owner FK, the three-board cap,
board shape and uniqueness checks, direct-RPC validation of board arrays, carry-over of existing
boards (checked by hand while migrating), and that discovery reads only the owner's data on web
and MCP clients. Playwright covers automatic lookup and pre-ticking, weak matches left unticked,
the three-board limit, adding by URL, editing the board set, and suggestions from applications.
A live run on 2026-09-23 found Stripe, Datadog, and Scale AI (Greenhouse) and Ramp and Notion
(Ashby), each rated high, and nothing for a made-up company. Palantir's Lever board timed out at
first; after the Lever page size was cut to 5 it was found with the name "Palantir Technologies"
in about a second.
