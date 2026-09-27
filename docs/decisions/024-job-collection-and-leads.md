# 024 - Job collection and the Leads inbox

Status: Accepted by the owner on 2026-09-25 (implementation handoff for "Check for new jobs" and a
minimal Leads inbox; the deterministic foundation for later agentic review). Builds on decisions
018-023. No scheduling, ranking, LLM calls, MCP tools, or extension changes.

## Context

The watchlist records which public boards belong to which companies, but nothing read them. The
owner wants new openings to land somewhere reviewable, and later wants an agent to assess them.
That agent needs trustworthy facts: which postings exist, when jword first and last saw them,
whether they are still listed, and what the owner decided. Those facts must survive watch edits
and deletion, and must never be guessed from incomplete scans.

## Decision

### Collection (`packages/core/src/collection/`)

`JobCollector.collect(provider, identifier)` reads every posting on one board and returns
`complete`, `partial`, or `failed` with a reason code. It contacts only hosts built from a
validated board identifier, refuses redirects, caps response sizes, and has a 45-second
per-board budget (shared HTTP rules in `discovery/http.ts`).

| Provider   | Endpoint                                                                    | Paging                          | Posted date                 |
| ---------- | --------------------------------------------------------------------------- | ------------------------------- | --------------------------- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` (documented) | one response (≤30 MB)           | `first_published`           |
| Lever      | `api.lever.co/v0/postings/{site}` (documented)                              | `skip`/`limit` 100, ≤50 pages   | `createdAt`                 |
| Ashby      | `api.ashbyhq.com/posting-api/job-board/{name}` (documented)                 | one response; unlisted skipped  | `publishedAt`               |
| Workday    | `{account}.{cluster}.myworkdayjobs.com/wday/cxs/…/jobs` (undocumented)      | 20 per page, 4 at a time, ≤2000 | never (only "Posted Today") |

A scan is `partial`, never `complete`, when any page fails, a posting is malformed (it is
skipped), the 5,000-posting limit is reached, the time budget runs out mid-board, Workday's total
is at its 2000 cap, or fewer unique Workday postings were read than it reported (postings shift
while paging). A 404 or an unreadable first page is `failed`. Descriptions are plain text,
trimmed to 10,000 characters; Workday descriptions are not fetched (one request per posting).
Posting links are built by jword from the provider host and posting id, never copied from
the response, so a provider cannot inject a `javascript:` or off-site link.

`checkForNewJobs({ watchId? })` checks one watch (active or not) or every active watch. Boards
run three at a time within a 240-second budget; boards not started in time report
`NOT_CHECKED`. One board failing never stops the others; authorization failures stop the check.
Careers pages (`OTHER`) report `unsupported`. The result lists each board's status, reason, and
counts (read, new, updated, listed again, no longer listed) plus totals.

### Persistence (`supabase/migrations/20260925000100_leads.sql`)

- **`lead_sources`**: one row per `(owner, provider, lower(identifier))` ever collected, with
  the company it was last collected for. It has **no foreign key to watches or boards**, so
  deleting a watch or removing a board keeps its leads, and re-adding the same board (any case)
  reuses the source instead of duplicating postings. Its URL must match `canonical_board_url`.
- **`leads`**: unique `(owner, source, provider_posting_id)`; owner-scoped foreign keys to
  source, company, and application (all restrict); description, stated posting date,
  `first_seen_at`, `last_seen_at`. **Availability** (`AVAILABLE`/`UNAVAILABLE` + since) and
  **review status** (`NEW`/`DISMISSED`/`PROMOTED` + application link) are separate columns;
  checks enforce `PROMOTED ⇔ application_id` and `UNAVAILABLE ⇔ unavailable_at`.
- **`lead_scans`**: the audit record of each board check (actor, historical watch id, status,
  reason, counts, times). **`lead_activities`**: audit of Dismiss, Restore, and Create
  application. **`lead_overview`**: `security_invoker` read model without descriptions.
- Owner-only RLS select on all four; writes only through functions (decision 010).

Collection writes in three calls so a large board can be saved in chunks of 250:

1. `begin_lead_scan` checks the board is on the owner's watch now, upserts the source (which
   serializes concurrent begins), marks scans running over five minutes `INTERRUPTED`, refuses
   a second running scan of the same source (`SCAN_IN_PROGRESS`), and records `started_at`.
2. `record_lead_postings` validates each posting and upserts it: new postings are inserted;
   known ones are refreshed, made available again, and counted as updated or listed again. It
   **never changes review status, the application link, or the version**. A stated posting
   date is kept if the provider later omits it.
3. `finish_lead_scan` records the outcome. **Only `COMPLETE` marks postings unavailable**, and
   only those whose `last_seen_at` is before this scan started.

### Review and application creation

`set_lead_review_status` (Dismiss ↔ Restore) and `create_application_from_lead` follow the usual
contract: expected version, request-id receipt, audit row, one transaction. Creating an
application reuses `jword.create_tracked_job` (the same duplicate check, company match, and
`dateFound` default as any new application) with the lead's title, link, location,
description, stated posting date, `externalJobId` = posting id when ≤100 characters, and
`source` = provider name, then links the lead and marks it `PROMOTED` in the same transaction.
A duplicate rolls everything back and returns `DUPLICATE_CANDIDATES`; `allowDuplicate` after
review creates it. A promoted lead cannot be dismissed or promoted again. Collection never
creates applications.

### Web

`/leads` lists leads (New by default) with search and company/review/listing filters, the posting
link, Dismiss/Restore, and Create application (duplicate review and retained request id).
"Check for new jobs" checks every active watch and shows per-board outcomes; each watchlist row
has "Check jobs" for that company. Both run as Server Actions on pages with `maxDuration = 300`.
Browser tests use `E2E_FIXTURE_POSTINGS` under the existing fixture guard.

Deferred: MCP tools for leads and agent assessment storage. The services (`listLeads`,
`getLead`, `listLeadCompanies`) are shared so those tools can be added without new business logic.

## Why not other approaches

- **Store leads in `jobs`.** `jobs` backs applications; mixing unreviewed postings into it
  would put them into duplicate checks, application views, and imports.
- **Key leads to `company_watch_boards` rows.** Board rows are deleted with their watch or on
  removal, which would either cascade leads away or leave dangling references.
- **One transaction per board.** Greenhouse descriptions alone can be 5 MB; chunked upserts are
  idempotent, and only the final step makes availability claims.
- **Close postings missing from any scan.** Partial scans are common (timeouts, Workday's cap);
  a false "closed" would hide real openings.

## Tradeoffs and limits

- The check runs inside a Server Action, so one long check occupies the page's action queue;
  Dismiss clicked during a check waits for it. There is no background job or progress stream.
- Workday boards at the 2000 cap never produce a complete scan, so their postings are never
  marked unavailable. Workday leads have no description or posting date.
- A scan interrupted mid-way leaves a `RUNNING` row that blocks that board for up to five minutes.
- The Workday endpoint is undocumented; its paging can shift, which is reported, not hidden.
- `lead_sources.company_id` follows the most recent watch; leads of a board re-added under a
  different company move with it on the next check.

## Verification

Unit tests: every provider's parsing and paging against a fake network (complete, partial,
failed, capped, shifting pages, malformed postings, timeouts, never requesting invalid ids), and
the lead services on the in-memory repository (dedup, preserved review status, availability only
from complete scans, relisting, stated dates, unsupported boards, active-only checks, retention
and source reuse, one running scan per board, owner isolation, versions/no-ops, retry-safe and
duplicate-checked application creation). Database tests run the same rules against the real
SQL, including concurrent scans, RLS, direct-write denial, command validation, and table
constraints. Playwright covers the inbox, duplicate confirmation, a partial Workday scan from
the watchlist, and mobile cards. A live read-only run on 2026-09-25: Datadog Greenhouse 449
(complete, 0.8 s), Palantir Lever 321 (complete, 5.7 s), Ramp Ashby 157 (complete, 0.4 s),
Salesforce Workday 1,527 of 1,527 (complete, 13 s), NVIDIA Workday 2,000 (partial,
TOTAL_CAPPED, 25 s).
