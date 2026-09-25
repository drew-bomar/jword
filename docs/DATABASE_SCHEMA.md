# jword v1 database schema

## Conventions

- PostgreSQL through Supabase.
- UUID primary keys generated with `gen_random_uuid()`.
- Exception: mutation receipts use the caller-generated request ID with the owner as their composite primary key.
- `timestamptz` for instants; `date` for calendar dates such as application date.
- snake_case database names and generated TypeScript types.
- every user-owned table includes `user_id uuid not null references auth.users(id)`.
- `created_at` and `updated_at` default to `now()`; use a shared trigger for `updated_at`.
- enable RLS on every user-owned table before shipping.
- Required ownership and relationship columns are NOT NULL. Enforce nonblank company names, job titles, and note bodies, plus required enum defaults, in database constraints as well as boundary validation.

## Enums

### `application_status`

```text
SAVED
RESEARCHING
READY_TO_APPLY
APPLIED
OA
INTERVIEW
FINAL
OFFER
REJECTED
WITHDRAWN
```

### `application_priority`

```text
LOW
MEDIUM
HIGH
```

### `work_arrangement`

```text
UNKNOWN
REMOTE
HYBRID
ONSITE
```

### `activity_type`

```text
CREATED
STATUS_CHANGED
DETAILS_UPDATED
NOTE_ADDED
NOTE_UPDATED
IMPORTED
```

### `ats_provider` (decision 018)

```text
GREENHOUSE
LEVER
ASHBY
OTHER
```

### `watch_event_type` (decision 018)

```text
WATCH_CREATED
WATCH_UPDATED
WATCH_ACTIVATED
WATCH_DEACTIVATED
```

### `actor_type`

```text
USER
CODEX
IMPORT
SYSTEM
```

## Tables

### `companies`

| Column            | Type        | Notes                                                                                        |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `id`              | uuid        | primary key                                                                                  |
| `user_id`         | uuid        | owner                                                                                        |
| `name`            | text        | required display name                                                                        |
| `normalized_name` | text        | required; trim/collapse whitespace and lowercase only; retain punctuation and legal suffixes |
| `website_url`     | text        | nullable                                                                                     |
| `target_company`  | boolean     | default false                                                                                |
| `interest_level`  | smallint    | nullable, check 1-5                                                                          |
| `notes`           | text        | nullable                                                                                     |
| `created_at`      | timestamptz | default now                                                                                  |
| `updated_at`      | timestamptz | default now                                                                                  |

Constraint/index:

- unique `(user_id, normalized_name)`
- unique `(user_id, id)` for owner-consistent child references
- index `(user_id, name)`

### `jobs`

| Column             | Type        | Notes                                                                       |
| ------------------ | ----------- | --------------------------------------------------------------------------- |
| `id`               | uuid        | primary key                                                                 |
| `user_id`          | uuid        | owner                                                                       |
| `company_id`       | uuid        | required; composite FK `(user_id, company_id)` to companies `(user_id, id)` |
| `title`            | text        | required                                                                    |
| `normalized_title` | text        | matching/import helper                                                      |
| `job_url`          | text        | nullable                                                                    |
| `external_job_id`  | text        | nullable                                                                    |
| `location`         | text        | nullable                                                                    |
| `work_arrangement` | enum        | default UNKNOWN                                                             |
| `description`      | text        | nullable; entered manually or captured from a posting (decision 016)        |
| `date_posted`      | date        | nullable                                                                    |
| `source`           | text        | nullable                                                                    |
| `created_at`       | timestamptz | default now                                                                 |
| `updated_at`       | timestamptz | default now                                                                 |

Indexes:

- unique `(user_id, id)` for owner-consistent application references
- `(user_id, company_id)`
- `(user_id, normalized_title)`
- non-unique `(user_id, job_url)` where `job_url is not null`
- non-unique `(user_id, company_id, external_job_id)` where external ID is not null

Do not enforce company + title, job URL, or external ID uniqueness because companies can repost the same role or reuse identifiers. These values support duplicate warnings, not automatic merging or rejection. See [decision 006](decisions/006-import-duplicate-choices.md).

### `applications`

| Column             | Type                 | Notes                                                                                             |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| `id`               | uuid                 | primary key                                                                                       |
| `user_id`          | uuid                 | owner                                                                                             |
| `job_id`           | uuid                 | required; composite FK `(user_id, job_id)` to jobs `(user_id, id)`                                |
| `version`          | integer              | not null, default 1, check >= 1; increments on each meaningful application change                 |
| `status`           | application_status   | default SAVED                                                                                     |
| `priority`         | application_priority | default MEDIUM                                                                                    |
| `date_found`       | date                 | nullable                                                                                          |
| `applied_at`       | date                 | nullable                                                                                          |
| `last_activity_at` | timestamptz          | default now; time a meaningful change is recorded, independent of a backdated event or note label |
| `resume_version`   | text                 | nullable reference label only; no file storage in v1                                              |
| `referral`         | text                 | nullable free-text summary                                                                        |
| `created_at`       | timestamptz          | default now                                                                                       |
| `updated_at`       | timestamptz          | default now                                                                                       |

Constraints/indexes:

- unique `(user_id, job_id)` for v1: one tracked application lifecycle per job
- unique `(user_id, id)` to support owner-consistent note and activity references
- `(user_id, status)`
- `(user_id, priority)`
- `(user_id, last_activity_at desc)`
- check: `applied_at` may be null for any status because imported data can be incomplete

Neither date column has an unconditional database default. Shared services apply the approved `America/Chicago` defaults for interactive web/MCP commands; imports preserve missing dates as null. An omitted date can receive its applicable default, while an explicit null represents a deliberate blank. See [decision 011](decisions/011-date-defaults-and-timezone.md).

When the user explicitly imports a flagged duplicate as a separate application, create a distinct job row and application row. Do not reuse or modify the existing job/application pair. This preserves the one-application-per-job constraint while allowing deliberate duplicates; existing company matching remains separate from application duplicate handling.

### `application_notes`

One row per individual note in the application's single Notes section. This replaces `applications.notes` and note bodies stored only as timeline activities. See [decision 012](decisions/012-single-notes-section.md).

| Column           | Type        | Notes                                                                              |
| ---------------- | ----------- | ---------------------------------------------------------------------------------- |
| `id`             | uuid        | primary key                                                                        |
| `user_id`        | uuid        | owner; required FK to auth.users                                                   |
| `application_id` | uuid        | required; composite FK `(user_id, application_id)` to applications `(user_id, id)` |
| `body`           | text        | required, nonblank note text                                                       |
| `created_at`     | timestamptz | actual insertion time, default now                                                 |
| `updated_at`     | timestamptz | actual latest edit time, default now                                               |

Index `(user_id, application_id, created_at desc, id)` for stable note ordering. Text is editable through the narrow add/update note functions; the optional date label was removed in [decision 015](decisions/015-remove-note-date-labels.md). Notes inherit owner-scoped RLS, function-only writes, application version checks, and retry protection. Note deletion remains outside v1.

### `application_activities`

Append-only through approved mutation functions; direct authenticated writes are denied.

| Column           | Type          | Notes                                                                                                |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | uuid          | primary key                                                                                          |
| `user_id`        | uuid          | owner                                                                                                |
| `application_id` | uuid          | required; composite FK `(user_id, application_id)` to applications `(user_id, id)` on delete cascade |
| `type`           | activity_type | required                                                                                             |
| `actor_type`     | actor_type    | required                                                                                             |
| `summary`        | text          | concise human-readable event                                                                         |
| `metadata`       | jsonb         | structured before/after or import context; default `{}`                                              |
| `occurred_at`    | timestamptz   | event time, default now                                                                              |
| `created_at`     | timestamptz   | insertion time, default now                                                                          |

Indexes:

- `(user_id, application_id, occurred_at desc)`
- `(user_id, occurred_at desc)`

Metadata examples:

```json
{
  "from": "APPLIED",
  "to": "OA"
}
```

```json
{
  "fields": ["priority", "applied_at"]
}
```

Do not store secrets or entire CSV rows in metadata. Capture actual changed-field before/after values inside the transaction for a trustworthy history, rather than accepting caller-claimed prior values. History access has the same owner restrictions as the application; safe mutation responses and operational logs omit sensitive text.

Note additions and edits produce NOTE_ADDED and NOTE_UPDATED activities with a stable `noteId`. For edits, retain changed text/date before-and-after values under the same owner access controls so history describes the actual edit; do not copy note text into server logs, retry receipts, or mutation responses. The Notes section displays current note records. The activity timeline describes additions/edits automatically and is not a second note-entry interface.

### `mutation_requests`

Small internal receipt table for retry protection, approved in [decision 009](decisions/009-mutation-retry-protection.md). It is not an additional product feature or activity timeline.

| Column       | Type        | Notes                                                                                                                                        |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`    | uuid        | owner; not null, FK to auth.users                                                                                                            |
| `request_id` | uuid        | caller-generated ID, reused for retries of the same command                                                                                  |
| `operation`  | text        | validated operation name                                                                                                                     |
| `input_hash` | text        | fingerprint of the canonical validated command and actor type, including expected version and import choices, before time-dependent defaults |
| `result`     | jsonb       | minimal safe successful result, including no-op results; no raw notes, CSV contents, or secrets                                              |
| `created_at` | timestamptz | default now                                                                                                                                  |

Primary key: `(user_id, request_id)`. Enable RLS and keep receipts internal to the mutation functions, with no direct client writes. Commit a receipt in the same transaction as the operation's primary changes and activity. For imports, one receipt covers the entire selected batch. Retain receipts for v1; no automatic expiry or cleanup job is required.

### `candidate_profiles`

Included in the MVP at the owner's request on 2026-09-21 ([decision 014](decisions/014-mvp-implementation-deviations.md)). One row per user, primary key `user_id`; columns `full_name`, `email`, `phone`, `location`, `linkedin_url`, `github_url`, `portfolio_url`, `school`, `degree`, `graduation_date` (date), `work_authorization`, `requires_sponsorship` (nullable boolean), timestamps. Owner-only RLS select; writes only through `public.save_candidate_profile(p_owner_id, p_command)`. No activity timeline and no MCP tool.

### `company_watches` (decision 018)

Which companies' public job boards jword should monitor later. Configuration only.

| Column             | Type         | Notes                                                                                          |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------------- |
| `id`               | uuid         | primary key                                                                                    |
| `user_id`          | uuid         | owner                                                                                          |
| `company_id`       | uuid         | required; composite FK `(user_id, company_id)` to companies `(user_id, id)` on delete restrict |
| `active`           | boolean      | default true; Deactivate sets false                                                            |
| `provider`         | ats_provider | required                                                                                       |
| `board_identifier` | text         | Greenhouse token / Lever slug / Ashby name; required for supported providers, null for OTHER   |
| `board_url`        | text         | derived canonical board URL for supported providers; optional careers page for OTHER           |
| `version`          | integer      | default 1; decision 008 conflict checks                                                        |
| `created_at`       | timestamptz  | default now                                                                                    |
| `updated_at`       | timestamptz  | default now                                                                                    |

Constraints/indexes: unique `(user_id, company_id)`; unique `(user_id, id)`; unique
`(user_id, provider, lower(board_identifier))` where the identifier is not null; index
`(user_id, active)`; check `company_watches_board_shape` (identifier pattern
`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` and `board_url` equal to the canonical URL for supported
providers, identifier null for OTHER); check that `board_url` is http(s).

No collection columns (last checked, error count, schedule); those belong to the collection
ticket. `companies.target_company` is left unused; an active watch is the signal.

**Changed by decision 019 (migration 20260923000100):** `provider`, `board_identifier`, and
`board_url` moved to `company_watch_boards`; the board constraints above now live there.

### `company_watch_boards` (decision 019)

Up to three job boards per watch. Columns: `id`, `user_id`, `watch_id` (composite FK
`(user_id, watch_id)` to company_watches, on delete cascade), `position smallint` (check 1-3,
unique per watch: the database caps a watch at three boards), `provider ats_provider`,
`board_identifier` (null for OTHER), `board_url` (not null: canonical URL for supported
providers, careers page for OTHER), `created_at`. Constraints: unique `(watch_id, board_url)`;
unique `(user_id, provider, lower(board_identifier))` where not null (a board belongs to one
company per owner); the same shape check as decision 018; http(s) URL check. Owner-only RLS
select; writes only inside `create_company_watch` / `update_company_watch`, which replace the
set and record before/after lists in the audit metadata. `company_watch_overview` exposes
`boards` (JSON array in position order) and `board_providers`.

Migration `20260923000200_watchlist_review.sql` ([decision 020](decisions/020-watchlist-reliability.md))
preserves IDs and `created_at` for retained boards, including reorders. The position uniqueness
constraint is deferrable during reconciliation and is checked before returning. Removed boards
remain deleted configuration. Create/update lock company before watch and translate concurrent
board claims into `BOARD_ALREADY_WATCHED`; duplicate canonical URLs are rejected before writing.

### `company_watch_activities` (decision 018)

Audit for watch mutations, the watchlist's counterpart of `application_activities`.
Columns: `id`, `user_id`, `original_watch_id` (immutable historical identity), `watch_id`
(nullable live reference, composite FK `(user_id, watch_id)` to company_watches),
`type watch_event_type` (including WATCH_DELETED), `actor_type`, `summary`, `metadata jsonb`
(changed field names; before/after scalar fields; never company-notes text), `occurred_at`,
`created_at`. Indexes `(user_id, watch_id, occurred_at desc)` and
`(user_id, original_watch_id, occurred_at desc)`.

Decision 021 (`20260924000100_delete_company_watch.sql`) replaces cascading audit deletion with
`ON DELETE SET NULL (watch_id)`. New activities start with a live watch: a before-insert trigger
copies its ID to `original_watch_id`, and the composite FK checks ownership. The historical ID
and owner survive deletion; existing event payloads stay unchanged. `delete_company_watch`
requires explicit confirmation and the current version, records the deleted board set in audit
metadata, deletes the watch/boards, and commits a replayable receipt atomically. Company and
application rows stay intact. Re-adding creates a new watch, with separate history.

### `company_watch_overview` view

`security_invoker = true` read model joining a watch with its company (name, website, interest,
notes), an application count, and the latest audit entry.

## RLS and write permissions

Approved in [decision 010](decisions/010-function-only-web-writes.md): authenticated web users can read their own tracker rows and execute approved mutation functions, but cannot directly insert, update, or delete table rows. Internal request receipts are accessed through the mutation functions, not a browser table API.

Use owner-scoped Row Level Security (RLS) for exposed reads, equivalent to:

```sql
using (auth.uid() = user_id)
```

RLS remains enabled on all user-owned tables. Revoke direct table mutation grants from `anon` and `authenticated`; no owner write policy should reintroduce direct web writes. Revoke default public/anonymous function execution and grant only the approved entry points. Privileged mutation implementations must use a fixed search path, schema-qualified references, typed inputs, and explicit ownership checks. Keep privileged implementation functions in a private schema behind narrow exposed wrappers; do not expose arbitrary SQL or generic table updates.

Derive the web owner from the verified session (`auth.uid()`), rejecting absent identity or conflicting supplied scope. Privileged functions must not assume that RLS automatically filters writes made with their elevated permissions. The approved local service-role caller remains a separate privileged path with explicit configured-owner scope and service/repository checks.

Test at minimum:

- owner can read their tracker rows and create/update through approved functions
- direct authenticated table insert/update/delete fails, including for the owner's own rows, activity history, and request receipts
- approved functions preserve atomic history, version checks, and retry receipts
- another authenticated user cannot select/update/delete owner rows
- anonymous clients cannot read or mutate rows
- anonymous or unapproved function execution fails
- cross-owner foreign-key combinations fail both through services and through direct database constraint tests

The MCP service-role path bypasses RLS, so service-layer owner checks and repository filters remain mandatory. Treat RLS as defense in depth, not the only authorization mechanism.

## Implemented function catalog

All public wrappers are `security definer` with `search_path = ''`, callable by `authenticated` and `service_role` only, and delegate to helpers in the private `jword` schema:

| Function                                                                    | Purpose                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `create_application(p_owner_id, p_actor, p_request_id, p_command, p_today)` | company match-or-create, job, application, optional initial note, CREATED activity; duplicate check unless `allowDuplicate`         |
| `update_application_status(...)`                                            | status and/or applied date; STATUS_CHANGED or DETAILS_UPDATED; no-op when unchanged                                                 |
| `update_application_details(...)`                                           | allowlisted application and job fields incl. company relink; DETAILS_UPDATED with before/after                                      |
| `add_application_note(...)` / `update_application_note(...)`                | add or replace note text; NOTE_ADDED / NOTE_UPDATED (decision 015)                                                                  |
| `import_applications(p_owner_id, p_actor, p_request_id, p_command)`         | all-or-nothing batch of up to 500 rows; no `p_today` because imports never receive date defaults                                    |
| `save_candidate_profile(p_owner_id, p_command)`                             | upsert of the profile row                                                                                                           |
| `create_company_watch(p_owner_id, p_actor, p_request_id, p_command)`        | company match-or-create or owned `companyId`, watch row, WATCH_CREATED audit; `ALREADY_WATCHED` / `BOARD_ALREADY_WATCHED` conflicts |
| `update_company_watch(...)`                                                 | allowlisted board and company fields with `expectedVersion`; WATCH_UPDATED; no-op when unchanged                                    |
| `set_company_watch_active(...)`                                             | deactivate/reactivate with `expectedVersion`; WATCH_DEACTIVATED / WATCH_ACTIVATED; no-op when unchanged                             |

Owner resolution: with a session, `auth.uid()` wins and a mismatching `p_owner_id` is `FORBIDDEN`; without a session only `service_role` may pass an explicit owner. Errors use SQLSTATEs `JW401/JW403/JW404/JW409/JW422/JW42I`, with the reason in `HINT` and JSON in `DETAIL`; `packages/core/src/repositories/errors.ts` maps them to typed errors.

The read model for the table and search is the `application_overview` view (`security_invoker = true`, so RLS still applies).

## Atomic mutation contract

These operations must commit or roll back as one unit:

- create company/job/application and any initial note + CREATED activity
- change application status + STATUS_CHANGED activity + `last_activity_at`
- update job/application details + DETAILS_UPDATED activity + `last_activity_at`
- add or edit an application note + NOTE_ADDED/NOTE_UPDATED activity + application version and `last_activity_at`
- commit all selected, confirmed import rows, their required company/job/application and initial-note writes, and one IMPORTED activity per imported application as a single batch

Approved mechanism: narrowly scoped Postgres functions called through Supabase RPC (remote procedure call). Each logical mutation, its activity, and related timestamps succeed or roll back in the same transaction. The shared service calls a repository operation, which invokes the function. Do not split the primary change and activity into separate requests. See [decision 002](decisions/002-atomic-mutations.md).

Database functions must verify ownership and reject invalid writes. Preserve the approved web-session and local service-role credential paths. Function-only web writes are approved in [decision 010](decisions/010-function-only-web-writes.md). Retry handling is approved in [decision 009](decisions/009-mutation-retry-protection.md).

For imports, use a narrow batch database function called once by the import repository. Revalidate the confirmed rows and duplicate choices at commit; do not trust a client preview as authoritative. Any row or activity failure rolls back the entire selected batch. Do not commit rows independently or catch errors and silently continue. Keep the batch bounded for a synchronous request; exact size limits are determined in Ticket 6. See [decision 007](decisions/007-atomic-import-batches.md).

## Retry protection

Every application save and import commit requires a `requestId`. After authorization, serialize attempts with the same `(user_id, request_id)` inside the mutation transaction. If a committed receipt matches the operation and input fingerprint, return its saved result without writing again. If the same ID is used for different input or a different operation, return `CONFLICT` with reason `REQUEST_ID_REUSED` and change nothing.

Check for a committed receipt before comparing application versions or rerunning duplicate detection. A successful request must remain safely retryable even though its own earlier commit incremented the version. Without a receipt, perform normal validation and version checks, then commit the changes, activity, and receipt together. Failed transactions retain none of those writes. Successful no-ops get a receipt but no new activity or version increment.

For fingerprints, use a stable representation of the validated caller intent before defaults such as today's date are resolved. Retries must reuse the original command and ID. An edited command or deliberate new import gets a new ID. A replay returns the original outcome and version, not a promise that the application has not changed since then; fetch current data when needed.

The database function must derive or validate the fingerprint against the actual typed command; an arbitrary caller-supplied hash cannot authorize a replay of different input. Authenticate and verify owner scope before returning a receipt. Serialize matching request IDs before taking application-row locks to keep retries and version checks ordered consistently.

## Concurrent edits

Approved in [decision 008](decisions/008-application-version-checks.md): return `version` with application reads and require `expectedVersion` for mutations of an existing application. After verifying ownership, the database function locks the application row and compares versions inside the same transaction as the mutation. A mismatch returns a typed `CONFLICT` with reason `STALE_VERSION` and commits no application or activity changes. Do not rely on a separate caller-side check.

Creation and imports start at version 1. Each meaningful status change, detail edit (including related job fields), or added/edited application note increments the application version once with its activity and timestamps. An initial note created with an application is part of that creation, not an additional version increment. A valid no-op does not increment it. Return the resulting version with successful mutations. This is a whole-application check, so edits to different fields can still conflict.

## Deletion

User-facing delete/archive behavior is out of v1. Foreign-key actions should still be intentional:

- company deletion should be restricted while jobs exist
- job deletion should be restricted while an application exists
- application deletion may cascade its activity rows only through administrative/manual database work

## Import mapping model

Do not persist upload files in v1. Parse and preview them transiently. A confirmed import maps into the canonical tables above.

Required import targets:

- company name
- job title

Optional targets:

- status
- job URL
- external job ID
- location
- work arrangement
- date posted
- date found
- date applied
- source
- priority
- notes (a nonblank CSV cell becomes one individual undated application note; preserve its text and line breaks)
- resume version
- referral

Unknown status/priority/date values become row-level validation errors or explicit warnings; they are never silently coerced to misleading values.

## Company matching

Use the same conservative normalization contract across creation, import, lookup, and database functions: trim, collapse whitespace, and lowercase; preserve punctuation, accents, and legal suffixes. Do not trust a caller-supplied normalized value. Reuse a company only on owner-scoped normalized exact match or explicit selection of its stable ID. Different names stay separate without alias inference. Company selection changes an application's job link, not the existing shared company row. See [decision 013](decisions/013-conservative-company-matching.md).

The normalized-name unique constraint serializes concurrent creation of the same company name. This uniqueness does not extend to jobs or applications. Company metadata columns do not authorize a separate company-management workflow in v1.

## Resolved schema review questions

1. **Resolved:** job URLs and external IDs are non-unique; warn about likely duplicates and honor the user's skip/import-as-separate choice, per [decision 006](decisions/006-import-duplicate-choices.md).
2. **Resolved:** one Notes section with individual editable notes and optional date labels; store current notes in `application_notes` and additions/edits in activity history, per [decision 012](decisions/012-single-notes-section.md).
3. **Resolved:** use `America/Chicago`; default date found on interactive creation and an empty applied date when entering APPLIED to today, with explicit overrides. Keep imported missing dates null, per [decision 011](decisions/011-date-defaults-and-timezone.md).
4. **Resolved:** ignore capitalization and extra whitespace only; preserve punctuation and legal suffixes, with no automatic alias matching, per [decision 013](decisions/013-conservative-company-matching.md).

## Direct-call validation (migration 005)

The public RPC signatures remain unchanged. Strict wrappers validate object shape, allowed keys, required fields, JSON types, text lengths, HTTP(S) URLs, enums, UUIDs, dates, and import rows before calling the private implementation. Rejected batches create neither rows nor receipts. Shared schemas provide the same checks before normal web/MCP calls. Text-only note edits accept up to 10,000 characters, matching the import limit so an imported note remains editable.

The profile exception from decision 014 remains a simple upsert without an application activity timeline or version. Tracker mutations retain their original atomic activity/version/receipt guarantees.

## Company watchlist (migration 20260922000100)

`company_watches`, `company_watch_activities`, and `company_watch_overview` follow the same
contract as the tracker: owner-only RLS select for `authenticated`, no table write grants for
`anon` or `authenticated`, and writes only through the three security-definer wrappers above.
The wrappers validate raw input with `jword.validate_watch_command` (a spec-driven copy of the
migration 005 rules) before the private implementations run. Every write commits the watch row,
any company-field change, one audit row, the version bump, and the `mutation_requests` receipt
in one transaction. See [decision 018](decisions/018-company-watchlist.md).
