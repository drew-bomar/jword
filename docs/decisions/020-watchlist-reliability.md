# 020 - Reliable watchlist discovery and configuration edits

Status: Accepted by the owner on 2026-09-23 following the JWO-16 code review.
Amends decisions 005, 018, and 019. No job collection or company editor is added.

## Decision

- Watchlist browser reads use three authenticated GET handlers under `/api/watchlist/`:
  `boards`, `companies`, and `suggestions`. Each verifies the session and owner, calls the same
  shared service as MCP, and returns private, non-cacheable JSON. Browser cancellation is passed
  into discovery. Mutations remain Server Actions. This avoids Next.js's sequential action queue
  making Save wait behind public provider lookups.
- Board selection belongs to the company currently entered. Changing its normalized name clears
  boards and remounts the picker; old requests are cancelled and ignored. An unresolved add or
  reactivation exposes only its original retry, retaining the exact command and request ID.
- Discovery attempts at most 15 boards total, including saved-application evidence, with six
  workers and a 12-second service budget including local enrichment. Each board has a six-second budget across
  all its HTTP calls, including optional details and fallback. Unchecked saved links remain visible
  with unverified reasons. `incomplete` reports partial provider failures; `unavailable` reports
  wholly unsuccessful provider checks. A missing result in either case is not proof of absence.
- Optional local enrichment failures produce warnings. Selected-company ownership and all
  authorization failures remain fatal. `ownershipChecked=false` means `watchedBy=null` is unknown:
  the browser does not preselect suggestions, and agents must ask before adding. Mutations still
  enforce board uniqueness inside Postgres.
- Only public provider evidence is cached, in a bounded in-process directory shared by callers:
  five minutes, at most 256 entries, six active probes and 30 queued probes. Concurrent identical
  probes share work. One caller's cancellation does not cancel another's subscription; work with
  no subscribers is cancelled. Failures are cached for five seconds. Private company/application
  data and full discovery responses are never cached.
- Provider JSON must satisfy a minimal Zod schema. Malformed responses mean unverified rather
  than empty or missing. Redirects are refused so all requests stay on the fixed provider hosts.
  An Ashby organization-query failure falls back to its documented public posting API when time
  remains. The fallback has no company-name/website evidence, and excludes unlisted postings.
- Fixtures require both `JWORD_E2E=1` and local Supabase URLs, checked at startup and directory
  construction. A production build can be tested locally; `NODE_ENV` alone is not the guard.
- Migration `20260923000200_watchlist_review.sql` makes create and update lock company before
  watch, translates concurrent board claims using raw input, and rejects duplicate canonical URLs
  consistently in SQL and TypeScript. Full-set replacement remains the API, but retained boards
  keep their row IDs and creation times, including on reorder. The position constraint is deferred
  during reconciliation and checked before the helper returns; the three-board cap remains.

## Tradeoffs and limits

The small public-evidence cache is per process, not a distributed rate limiter. Restarting or
scaling the server creates another cache. Evidence can be five minutes old; saved board ownership
is always read fresh and validated again when saving. Optional failures reduce available evidence
without weakening permission checks. There is no background refresh, Redis, or work queue service.

Retained board IDs are stable, but deliberately removed boards are still deleted configuration.
Before collection adds foreign keys, that ticket must decide how removed sources retain history.
The watch version continues to guard company fields because the watchlist is their only editor;
a future company editor must share or replace that concurrency contract.

## Learning checkpoint

Browser reads → authenticated GET → shared watchlist service → owner-scoped repository and public
board directory. Browser saves → Server Action → same service → database transaction. MCP enters
at the same service in both cases. Cancellation and caching affect reads; the database remains the
authority for ownership, versions, audit records, and retry receipts.

## Verification

Regression tests cover company switching, lookup transport recovery, saves during slow discovery,
lost reactivation responses, signed-out JSON reads, and reopening the tracker editor. Unit tests
cover partial discovery, cancellation, total budgets, public response validation/fallback, cache
sharing/expiry/bounds, fixture guards, and duplicate URL validation. Database tests cover stable
board IDs, audit snapshots, concurrent board claims, and the company/watch lock order.
