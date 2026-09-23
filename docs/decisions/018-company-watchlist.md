# 018 - Company watchlist

Status: Accepted by the owner on 2026-09-22 (JWO-16 implementation prompt, which approved writing
and implementing this record in one run). Narrows one item of the v1 exclusions; see Scope.

## Context

The owner approved a job-discovery direction built in small slices:

1. a company watchlist (this decision)
2. collecting postings from watched companies' public Greenhouse, Lever, and Ashby boards
3. a separate Leads inbox with deterministic filtering and promote-a-lead-to-application
4. later, possibly grading leads by match likelihood (design undecided)

Step 2 needs a trustworthy list of _which boards to read_. That list is owner-edited
configuration. It is not an application, and it is not a discovered job. This decision records
only that configuration. Nothing fetches, stores, schedules, or ranks postings yet.

## Decision

### A separate `company_watches` table, one watch per company

- Columns: `user_id`, `company_id`, `active`, `provider`, `board_identifier`, `board_url`,
  `version`, timestamps.
- Composite foreign key `(user_id, company_id) -> companies (user_id, id)`, restricted on
  delete. A watch can only point at a company owned by the same user; the database enforces it,
  not just the code. There is no cascade from companies to watches.
- `unique (user_id, company_id)`: one watch per company per owner, active or not.
- Partial unique index `(user_id, provider, lower(board_identifier))`: the same board cannot be
  watched under two company names, which would make step 2 collect it twice.
- `version` follows decision 008. Every meaningful change increments it once.

### Reused company fields

`interest_level`, `notes`, and `website_url` already live on `companies` and describe the
company, not the watch. The watchlist edits them in place rather than copying them. They are
changed only through the watch functions, inside the same transaction as the watch row, and
counted in the watch's version. No other screen edits them today. A future company editor would
need its own version check.

`target_company` is **left alone** and documented as unused. Nothing reads it, and keeping a
second flag in sync with "has an active watch" would create two sources of truth. An active
watch is the signal from now on. Removing the column is a separate cleanup if the owner wants
it.

The company **name** is not editable from the watchlist. Renaming a company changes how every
application displays and interacts with decision 013 matching; that belongs to a company-editing
ticket, if ever.

### Provider and board identifier

- Enum `ats_provider`: `GREENHOUSE`, `LEVER`, `ASHBY`, `OTHER`, following the existing enum
  conventions (Postgres enum + `ATS_PROVIDERS` tuple in core).
- `board_identifier` is the Greenhouse board token, Lever site slug, or Ashby job-board name.
  Pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, deliberately conservative. Case is preserved as
  entered; uniqueness ignores case.
- For supported providers `board_url` is **derived**:
  `https://job-boards.greenhouse.io/{id}`, `https://jobs.lever.co/{id}`,
  `https://jobs.ashbyhq.com/{id}`. A check constraint makes a mismatch impossible, and a caller
  that sends a board URL for a supported provider gets `BOARD_URL_DERIVED`.
- `OTHER` means watched but with no supported board. The identifier must be null. `board_url`
  may hold an optional careers page.
- URL inference is a pure function in `packages/core/src/watchlist/boards.ts`. It recognizes the
  five URL shapes in the ticket, ignores job paths, queries, and fragments, and returns
  `{ provider, boardIdentifier, boardUrl }` or null. The UI uses it to pre-fill the form; the
  owner can correct everything, and the server validates the final values again. The SQL
  pattern and URL builder mirror the TypeScript, like `normalize_name`.

### Company resolution when adding

A company name reuses an exact decision-013 match (trim, collapse whitespace, ignore case) or
creates the company. A selected `companyId` wins over the name and must belong to the owner
(`COMPANY_NOT_FOUND` otherwise). Adding a company that already has a watch, active or not, is
`CONFLICT` / `ALREADY_WATCHED` with `watchId`, `watchActive`, and `currentVersion` in the error,
so the web form can offer "Reactivate it" and an agent can call `set_company_watch_status`.
Adding never creates or changes applications or jobs.

### Deactivation, not deletion

"Remove from watchlist" sets `active = false`. Nothing is deleted. Deactivation never touches
the company, its applications, or any history. Reactivation flips the flag back.

### Auditing

`application_activities` is keyed to an application, so it cannot hold watch events. A small
`company_watch_activities` table mirrors it: `watch_id` (composite owner FK), `type`
(`WATCH_CREATED`, `WATCH_UPDATED`, `WATCH_ACTIVATED`, `WATCH_DEACTIVATED`), `actor_type`,
`summary`, `metadata` (changed field names plus before/after for scalar fields), and
timestamps. Company-notes text is recorded only as a changed field name, never copied into
metadata, receipts, results, or logs.

Three functions: `create_company_watch`, `update_company_watch`, and
`set_company_watch_active`. Each commits the watch row, any company-field change, one audit
row, the version bump, and the `mutation_requests` receipt in one transaction (decisions 002
and 009). Updates and status changes take `expectedVersion` (decision 008). Identical
values are a no-op with a receipt and no audit row. Direct RPC input is validated first, as in
migration 005.

### Same runtime path as the tracker

UI (client component) -> Server Action (`requireSession`, owner lock) -> shared Zod schema ->
`createWatchlistServices` in core -> repository -> Postgres function. The MCP server gets five
bounded tools (`list_watched_companies`, `get_watched_company`, `add_watched_company`,
`update_watched_company`, `set_company_watch_status`) that call the same services with actor
`CODEX`.

## Why ingestion, scheduling, Leads, and ranking stay deferred

Each brings its own hard questions: network failure modes and rate limits (collection), where
and how often something runs (scheduling; v1 excludes background workers), deduplicating and
triaging postings (Leads), and what "a good match" means (ranking). Shipping the watchlist first
lets the owner curate real data before those designs are chosen.

The design leaves clean seams for them:

- **Board adapter interface (next ticket).** In core, one adapter per supported provider:

  ```ts
  interface BoardAdapter {
    provider: SupportedBoardProvider;
    listPostings(board: { boardIdentifier: string }): Promise<BoardPosting[]>;
  }
  ```

  It reads only the provider's public, unauthenticated board API. The fetch function is
  injected so tests stay offline.

- **"Verify board" action.** A later Server Action and MCP tool would call
  `adapter.listPostings` for one watch and report "reachable, N open postings". It would not
  save postings. It sits beside `updateWatchedCompany` in the watchlist service. Today only
  the local format check exists.
- **Collection** iterates `company_watches where active`, keyed by the stable `watch_id` and
  `(provider, board_identifier)`. Collection state (last checked, error counts, schedule) goes
  in the collection ticket's own table, not here.
- **Leads** would reference `watch_id` and `company_id` with the same composite owner FKs. A
  promoted lead would go through the existing `createApplication` service.

## Alternatives considered

- **Columns on `companies`** (`watch_active`, `provider`, `board_identifier`). No join and no
  second table. But every company, including hundreds created by CSV import, would carry nullable
  watch columns. Watch history and versioning would mix with company identity. "One watch per
  company" would be implicit instead of a constraint. Collection state would crowd the company
  row too. Rejected.
- **Several boards per company** (drop the unique key). Some companies run more than one board,
  but this is rare for the owner's targets and it complicates "one watch per company" in the UI
  and MCP. Can be relaxed later by replacing the unique key; the id-based API does not change.
- **Reuse `application_activities` for audit** by making `application_id` nullable. This would
  weaken an existing invariant and every timeline query. Rejected in favor of a sibling table.
- **Store the board URL as entered.** More flexible but two sources of truth (URL vs identifier)
  that can disagree. Deriving it keeps collection unambiguous.
- **Sync `target_company` with active watches.** Rejected above (two sources of truth).

## Tradeoffs

- Some SQL mirrors TypeScript (identifier pattern, canonical URL, board rules). It is small and
  covered by tests on both sides.
- `jword.validate_object` repeats the rule loop of `jword.validate_command` instead of
  refactoring migration 005, to keep this ticket additive.
- Editing company fields through a watch means the watch version, not a company version, guards
  them. That is correct while the watchlist is the only editor.

## Scope

This narrows the v1 exclusion "automatic job discovery or scraping" only to _configuration_ of
which public boards to watch. Fetching postings, scheduling, Leads, recommendations, ranking,
and scraping LinkedIn/Indeed remain out of scope. There is still no delete in the product.

## Verification

Unit tests cover URL inference (all five shapes plus rejects), schemas, and every service rule
against the in-memory repository. Integration tests on the local database cover RLS and anonymous
denial, direct-write denial, the composite FK and check constraints, direct-RPC validation, an
injected audit failure rolling back the watch and a newly created company, deactivate/reactivate
preserving company and applications, and the MCP owner lock. Playwright covers add from a pasted
URL, edit, a two-tab stale edit, deactivate, the duplicate-to-reactivate path, existing-company
reuse, and phone cards.
