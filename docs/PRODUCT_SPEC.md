# jword v1 product specification

## Product statement

`jword` is a personal job-search operating system. Version 1 is intentionally narrower: a fast application tracker backed by structured data and safely controllable by both Drew and Codex.

The product succeeds when it replaces Drew's spreadsheet during the current application cycle without becoming a large side project.

## Primary user

One user: Drew. The data model must still be properly user-scoped so authentication and security are correct, but multi-user collaboration, billing, and administration are not product requirements.

## Core jobs to be done

1. Quickly capture a job worth tracking.
2. See every opportunity and its current application state.
3. Update status, dates, priority, and notes with minimal friction.
4. Find applications that need attention.
5. Import the existing Google Sheet without re-entering data.
6. See a trustworthy history of important changes.
7. Tell Codex what changed in natural language and have it perform bounded, auditable operations.

## Product principles

- Manual use must be excellent. AI is an additional interface, not a dependency.
- Prefer a dense, calm, Linear-style interface over a decorative dashboard.
- Important changes must be reversible through clear history or a deliberate follow-up update, even if one-click undo is not in v1.
- The system must ask for clarification when a natural-language reference matches multiple records.
- The database, not chat history, is the source of truth.
- Optimize for one user's speed and reliability before extensibility.

## Information model in product language

- **Company:** an employer, such as IBM or Datadog.
- **Job:** a specific opening, such as Backend Software Engineer.
- **Application:** Drew's tracked lifecycle for that job. A saved job receives an application record with status `SAVED` so the complete funnel can be shown in one table.
- **Activity:** an append-only timeline item describing a meaningful event or mutation.
- **Note:** an individual editable text entry on an application, stamped with when it was added and last edited (date labels were removed in [decision 015](decisions/015-remove-note-date-labels.md)).

A minimal candidate profile and settings form were added at the owner’s request in decision 014. Recommendations and autofill remain deferred.

## Status workflow

Allowed statuses:

1. `SAVED`
2. `RESEARCHING`
3. `READY_TO_APPLY`
4. `APPLIED`
5. `OA`
6. `INTERVIEW`
7. `FINAL`
8. `OFFER`
9. `REJECTED`
10. `WITHDRAWN`

The workflow is intentionally non-linear. The user may move between any statuses because real hiring processes are inconsistent. The system records the previous and next value rather than preventing unusual transitions.

Use `America/Chicago` for the owner's calendar dates, including daylight saving changes. "Today" means the date in that timezone, not the database server's or browser's timezone. New manually added applications default `date_found` to today. When entering `APPLIED`, default a missing `applied_at` to today unless the user explicitly supplies or clears the date; preserve existing dates unless explicitly edited. The same defaults apply to direct Codex creation/updates through the shared services. Imported missing dates stay blank, even for an imported `APPLIED` application. Both dates remain editable. Returning to an earlier status does not automatically erase dates. See [decision 011](decisions/011-date-defaults-and-timezone.md).

## Required screens

### 1. Sign in

- Email-based Supabase authentication using a link or code, accessible from computer and phone on the hosted tracker.
- Retain the browser session so sign-in is not required for every use; expiry or sign-out may require signing in again.
- No public sign-up experience is required beyond what is needed for the owner's account.
- Provision the owner account directly and disable public self-signup. Verify the session and configured owner on each protected web operation.
- Unauthenticated users cannot access tracker data.

### 2. Applications

The default home screen and primary workspace.

Required columns:

- company
- role
- status
- location
- date applied
- priority
- last updated

Required controls:

- add application
- free-text search over company and role
- filter by status and priority
- sort by updated date, applied date, company, and priority
- edit status and priority without leaving the table
- open an application detail view

Basic count chips or cards by active stage are permitted, but a full analytics dashboard is not required.

### 3. Add/edit application

Required form controls (only company name and role/title require user-provided values; other controls may be empty or use their documented defaults):

- company name
- role/title
- job URL
- location
- work arrangement: remote, hybrid, onsite, or unknown
- status
- date found
- date applied
- source
- priority
- optional initial note (later additions and edits use the same Notes section)
- external job/requisition ID when known

Company matching trims leading/trailing whitespace, collapses repeated whitespace, and ignores capitalization. Reuse only an exact match after those steps; preserve punctuation and suffixes such as Inc. or LLC, and do not guess abbreviations or aliases. For example, IBM and ibm match, while Acme and Acme Inc. remain separate unless the user explicitly selects the existing company. New names can create new companies. This never merges applications. See [decision 013](decisions/013-conservative-company-matching.md).

Changing the company on an application selects or creates a company and relinks that application's job; it does not rename a company shared by other applications. Dedicated company-wide editing/merging is not part of this tracker flow.

### 4. Application detail

Shows:

- job and company information
- current application state
- editable dates, priority, source, and URL
- one Notes section containing individual editable notes with their real added/edited timestamps
- chronological activity timeline
- add/edit note actions in the Notes section; activity history is generated automatically

The user can edit a note's text after saving; each note shows when it was added and last edited. There is no separate summary-notes field, timeline-note entry flow, or date label. Note edits retain activity history, and stale saves preserve the draft as with other application edits. See [decision 012](decisions/012-single-notes-section.md).

### 5. Import

CSV import flow:

1. Select a CSV file.
2. Preview headers and sample rows.
3. Map source columns to jword fields.
4. Validate all rows without writing.
5. Show valid rows, warnings, and errors.
6. Confirm import.
7. Save all selected, confirmed valid rows in one transaction and show a result summary. If any selected row fails during the database operation, roll back the whole selected batch, including its activity records.

Approved import failure policy: all-or-nothing for the selected batch. Preview errors must be corrected or excluded before confirmation. Skipped rows are not part of the batch, and existing applications are not overwritten. After a database failure, report that none of the selected rows were added and let the user correct the problem before retrying. A lost network response does not prove rollback; report an unconfirmed outcome instead of claiming success or failure. See [decision 007](decisions/007-atomic-import-batches.md).

Approved duplicate policy for v1: flag likely duplicates using normalized company + normalized title + job URL/external ID when available, including matches against the tracker and other rows in the upload. Let the user explicitly skip the row or import it as a separate application. Never automatically merge, overwrite, or delete existing applications. Preserving separate records is more important than preventing every duplicate. A matching URL or external ID is evidence for a warning, not a reason to forbid import. See [decision 006](decisions/006-import-duplicate-choices.md).

The minimal profile settings screen follows decision 014. API-key entry and AI-provider selection remain out of scope.

Saves and import commits retain a unique request ID while the result is unconfirmed. Retrying the same command reuses that ID and returns the prior committed result rather than repeating the change. A deliberate new operation, including a new import of identical rows, uses a new ID and follows the normal duplicate-warning rules. See [decision 009](decisions/009-mutation-retry-protection.md).

## Natural-language workflows

Natural-language commands happen in Codex, not inside a jword chat panel.

Examples:

- "I applied to the saved Datadog backend role today."
- "Move IBM Software Engineer to interview."
- "Add a note to Garmin that I finished the HireVue."
- "Show AI or ML roles I saved but have not applied to."
- "I was rejected from the Ramp backend role."

Expected behavior:

- Codex uses search/read tools first.
- If exactly one record matches, Codex calls a narrow mutation tool.
- If zero match, Codex reports that and offers to create a record when appropriate.
- If multiple matches, Codex lists concise choices and asks Drew to select one.
- The mutation response states exactly what changed.
- The web UI reflects the database change on refresh; live realtime synchronization is optional.

## Empty, loading, and error states

- Empty tracker: explain how to add the first application or import CSV.
- No filtered results: distinguish this from an empty tracker and offer to clear filters.
- Loading: use stable skeletons; avoid layout jumps.
- Errors: preserve typed input, show a useful message, and never claim a write succeeded unless the database confirms it.
- Outdated edit: if the application changed since it was loaded, reject the save and show "This application changed since you opened it. Refresh before saving." Preserve unsaved input separately while loading the latest record so the user can review and reapply it; do not automatically overwrite the newer record. See [decision 008](decisions/008-application-version-checks.md).

## Accessibility and responsive behavior

- Keyboard-accessible controls and visible focus states.
- Proper labels for all inputs.
- Status must not be communicated by color alone.
- Desktop is the primary use case, but all required actions must remain usable on a phone-sized viewport.
- Dense table may become stacked cards on small screens.

## Success criteria

- Drew can import the existing tracker and continue using jword as the primary record.
- Adding or updating an application manually takes only a few interactions.
- A Codex command cannot modify an ambiguous record without clarification.
- Every status change appears in the timeline with actor, old value, new value, and timestamp.
- The app incurs no separate LLM API usage in v1.
