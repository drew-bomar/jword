# jword v1 implementation plan

## How to use this plan

Track work in the existing [jword v1](https://linear.app/jword/project/jword-v1-7841cd83b06b) Linear project using the issues linked below. Use only lightweight labels such as `foundation`, `database`, `frontend`, `import`, `ai-tools`, and `quality`.

Every ticket should end with the learning handoff required by `AGENTS.md`. Do not begin a ticket until the preceding dependency is accepted.

## Linear tickets

Created in [jword v1](https://linear.app/jword/project/jword-v1-7841cd83b06b) on 2026-09-21. The statuses below are a creation snapshot; Linear is the source of truth for current progress. Each ticket depends on the preceding ticket.

| Plan ticket | Linear issue | Initial status |
| --- | --- | --- |
| Ticket 0 | [JWO-5: Pre-implementation architecture review](https://linear.app/jword/issue/JWO-5/ticket-0-pre-implementation-architecture-review) | Done |
| Ticket 1 | [JWO-6: Scaffold the application and quality gates](https://linear.app/jword/issue/JWO-6/ticket-1-scaffold-the-application-and-quality-gates) | Todo |
| Ticket 2 | [JWO-7: Supabase schema, migrations, auth, and RLS](https://linear.app/jword/issue/JWO-7/ticket-2-supabase-schema-migrations-auth-and-rls) | Backlog |
| Ticket 3 | [JWO-8: Shared domain, repository, and service layer](https://linear.app/jword/issue/JWO-8/ticket-3-shared-domain-repository-and-service-layer) | Backlog |
| Ticket 4 | [JWO-9: Applications table and create/edit flows](https://linear.app/jword/issue/JWO-9/ticket-4-applications-table-and-createedit-flows) | Backlog |
| Ticket 5 | [JWO-10: Application detail and activity timeline](https://linear.app/jword/issue/JWO-10/ticket-5-application-detail-and-activity-timeline) | Backlog |
| Ticket 6 | [JWO-11: CSV import preview and commit](https://linear.app/jword/issue/JWO-11/ticket-6-csv-import-preview-and-commit) | Backlog |
| Ticket 7 | [JWO-12: MCP server foundation and read tools](https://linear.app/jword/issue/JWO-12/ticket-7-mcp-server-foundation-and-read-tools) | Backlog |
| Ticket 8 | [JWO-13: MCP mutation tools and ambiguity evaluations](https://linear.app/jword/issue/JWO-13/ticket-8-mcp-mutation-tools-and-ambiguity-evaluations) | Backlog |
| Ticket 9 | [JWO-14: Release hardening and handoff](https://linear.app/jword/issue/JWO-14/ticket-9-release-hardening-and-handoff) | Backlog |

## Ticket 0 - Pre-implementation architecture review

**Decision status (2026-09-21)**

The owner approved email sign-in for the hosted web tracker and a private local service-role credential for the MCP connector, with no separate connector sign-in. See [decision 001](decisions/001-web-and-mcp-access.md).

The owner also approved deferring candidate-profile storage and its settings screen until future job recommendations or application autofill require them. No v1 ticket should implement profile tables or screens; see `V1_SCOPE.md`.

The owner also approved narrowly scoped database functions to commit each mutation and its activity together in one transaction. See [decision 002](decisions/002-atomic-mutations.md).

The owner also approved a pnpm workspace with a website, local MCP connector, and shared core. Future model integrations can use the same core without duplicating business rules; they remain out of v1 scope. See [decision 003](decisions/003-shared-core-workspace.md).

The owner also approved hosted-only Supabase development for this personal MVP, accepting that testing and real use share a database. Skip local Supabase and Docker setup; retain checked-in migrations and targeted tests. See [decision 004](decisions/004-hosted-only-development.md).

The owner also approved Next.js Server Actions for web mutations, retaining the shared service boundary. See [decision 005](decisions/005-web-server-actions.md).

The owner also approved warning about possible import duplicates and letting them skip or import each flagged row as a separate application. Automatic merging, overwriting, and deletion are prohibited; URLs and external IDs are non-unique. See [decision 006](decisions/006-import-duplicate-choices.md).

The owner also approved all-or-nothing imports: all selected, confirmed valid rows and their history commit in one transaction or roll back together on a database failure. See [decision 007](decisions/007-atomic-import-batches.md).

The owner also approved application version checks inside database saves. Reject outdated edits with a refresh warning, preserve unsaved input, and have Codex re-read and reassess before another attempt. See [decision 008](decisions/008-application-version-checks.md).

The owner also approved request-ID retry protection for saves and imports. Persist a minimal receipt with each committed operation; identical retries return the prior result without repeating writes. See [decision 009](decisions/009-mutation-retry-protection.md).

The owner also approved restricting normal web writes to approved database functions, preserving the existing broader local connector credential. See [decision 010](decisions/010-function-only-web-writes.md).

The owner approved `America/Chicago` for calendar dates: default date found to today on interactive creation and missing date applied to today when entering APPLIED, allow overrides, and keep imported missing dates blank. See [decision 011](decisions/011-date-defaults-and-timezone.md).

The owner approved one Notes section containing individual notes with optional dates, with both text and date editable after saving. Additions and edits generate activity history automatically; separate summary and timeline-note inputs are removed. See [decision 012](decisions/012-single-notes-section.md).

The owner approved conservative company-name matching: ignore capitalization and extra whitespace, preserve punctuation/legal suffixes, and never infer aliases or combine applications. See [decision 013](decisions/013-conservative-company-matching.md).

Ticket 0 review is complete: all five deliberate architecture choices and the discussed product decisions are approved. The final consistency pass and remaining implementation checks are recorded in [the final review](TICKET_0_REVIEW.md). No further pre-scaffolding product decisions are pending. At the owner's request, the `jword v1` Linear project and all ten issues were created with acceptance criteria, labels, and sequential dependencies. Ticket 0 is Done, Ticket 1 is Todo, and Tickets 2–9 are in Backlog. Ticket 1 has not started; the next owner instruction should authorize scaffolding.

**Goal**

Challenge the planning package before writing code.

**Scope**

- read `AGENTS.md` and every file under `docs/`
- identify contradictions, unnecessary complexity, missing decisions, and security risks
- recommend concrete changes
- explicitly resolve the five architecture decisions in `ARCHITECTURE.md`

**Out of scope**

- scaffolding
- dependencies
- database or application code

**Acceptance criteria**

- written review grouped by blocking, recommended, and optional findings
- proposed final decisions with rationale
- owner approves decisions before Ticket 1

**Learning checkpoint**

Explain the web/MCP/shared-service boundary and why language interpretation is not application authority.

## Ticket 1 - Scaffold the application and quality gates

**Goal**

Create the smallest runnable Next.js/TypeScript foundation.

**Scope**

- scaffold Next.js App Router, Tailwind, and shadcn/ui baseline
- configure and document pnpm workspaces with one lockfile, per decision 003
- add formatting, lint, typecheck, test, and build scripts
- create `.env.example`
- establish the root web application and shared-core package boundaries from the approved architecture; defer the MCP package implementation to Ticket 7
- add a minimal home/sign-in shell without product polish

**Out of scope**

- database tables
- real tracker UI
- MCP server

**Acceptance criteria**

- clean install and dev start work
- checks run in documented commands
- production build passes
- no secrets committed

**Learning checkpoint**

Explain App Router server/client boundaries and the repository's folder responsibilities.

## Ticket 2 - Supabase schema, migrations, auth, and RLS

**Goal**

Build and verify the secure persistence foundation.

**Scope**

- implement approved enums/tables/indexes/triggers in migrations
- configure Supabase clients for browser and server
- add owner email link/code authentication with persistent browser sessions for computer and phone access
- implement and test RLS policies
- restrict direct web table writes and define explicit function grants per decision 010; mutation functions are completed with their operations in Ticket 3
- generate TypeScript database types
- connect to one hosted Supabase project for development and real use; no local database or Docker requirement
- create only the targeted test records needed for verification; no automatic development seed into the real tracker

**Out of scope**

- full application UI
- CSV import
- MCP

**Acceptance criteria**

- initial migrations apply cleanly to the empty hosted project before real data is imported; subsequent migrations apply incrementally without resetting the tracker
- owner reads work and direct web table writes/deletes are denied; verify permitted creates and updates through their functions in Ticket 3
- second-user and anonymous access tests fail as expected
- composite ownership foreign keys reject cross-owner company/job/application/note/activity links at the database boundary
- browser bundle contains no server secrets
- schema deviations update `DATABASE_SCHEMA.md`

**Learning checkpoint**

Explain Supabase Auth, browser/server clients, RLS, and why service-role keys require extra care.

## Ticket 3 - Shared domain, repository, and service layer

**Goal**

Create the core business API before building the UI.

**Scope**

- shared enums/types and Zod schemas in `packages/core`
- repositories with explicit user scope
- services for search, get, create, status update, detail update, add note, and edit note
- atomic mutation + activity behavior through narrowly scoped Postgres functions called by repositories using Supabase RPC, per decision 002
- typed error model
- request-ID retry protection with internal receipts committed atomically with saves, per decision 009
- unit tests for business rules, plus targeted hosted-database integration tests for ownership and atomicity; no required local database

**Out of scope**

- polished UI
- import
- MCP transport

**Acceptance criteria**

- all core operations are callable through typed services
- authenticated callers can mutate their own records through approved functions but cannot bypass them with direct table writes
- create, status, detail, and note mutations commit atomically with their activity and related timestamps
- a forced activity-write failure rolls back the primary mutation in database integration tests
- competing mutations using the same application version cannot both succeed; the stale request returns `CONFLICT`/`STALE_VERSION` without changing data or activity
- meaningful edits increment the application version once; valid no-ops leave it unchanged
- identical sequential and concurrent retries return the committed result without duplicate records, activities, or version increments, including after a lost response
- request IDs reused with different commands return a conflict; failed writes leave no successful receipt
- unchanged status with no effective date change returns a no-op; a date-only change creates a detail activity
- date-default tests cover Central-time midnight/daylight saving boundaries, explicit overrides, and preservation of existing dates
- company matching follows decision 013, and relinking one application never renames a company shared by other applications
- duplicate candidates produce a conflict result
- tests cover validation and authorization boundaries

**Learning checkpoint**

Walk through one status update from service input to transaction and result. Explain why this layer is shared by web and MCP.

## Ticket 4 - Applications table and create/edit flows

**Goal**

Make jword useful as a daily manual tracker.

**Scope**

- authenticated applications screen
- search, status/priority filters, and sorting
- stage counts
- add application flow
- inline status and priority edits
- responsive behavior and required states
- Next.js Server Actions that verify the caller and invoke shared services, per decision 005

**Out of scope**

- detail timeline
- CSV import
- MCP

**Acceptance criteria**

- create and inline update work against Supabase
- filters/search/sort can be combined
- URL state or documented state strategy avoids confusing resets
- keyboard and mobile usability pass targeted checks
- errors do not produce false success UI
- stale edits display the refresh warning and preserve unsaved input for review against the latest application

**Learning checkpoint**

Explain data fetching/mutation strategy, server versus client components, and how UI calls reach the shared service.

## Ticket 5 - Application detail and activity timeline

**Goal**

Provide complete record editing and an understandable history.

**Scope**

- detail page/drawer based on approved UX
- editable job/application fields
- timeline with actor, event, and time
- one Notes section with add/edit text and optional Add date controls, per decision 012
- automatic NOTE_ADDED/NOTE_UPDATED history, without a separate summary or timeline-note entry flow

**Out of scope**

- interviews workspace
- attachments
- undo UI

**Acceptance criteria**

- direct navigation to a record works
- every meaningful mutation shows in the timeline
- undated and dated notes can be created; text and date can be edited, and date labels removed
- note edits update the existing note and preserve activity history, application version checks, and retry protection
- a note's chosen date never changes its actual creation timestamp
- missing/forbidden records render safe states

**Learning checkpoint**

Explain the difference between current state and an audit/activity log, including what this design does not provide compared with event sourcing.

## Ticket 6 - CSV import preview and commit

**Goal**

Migrate the existing Google Sheet safely.

**Scope**

- transient CSV parsing
- header mapping UI
- normalization and row validation
- preview with valid/warning/error groupings
- duplicate candidate warnings against existing applications and within the upload, with explicit skip or import-as-separate choices
- confirmed commit through import service and one transactional batch database function, per decision 007
- import result summary and sample template

**Out of scope**

- live Google Sheets integration
- background import jobs
- arbitrary spreadsheet formats beyond CSV

**Acceptance criteria**

- preview makes no database writes
- malformed dates/statuses are visible and not silently changed
- missing imported dates remain null, including for APPLIED records, rather than receiving interactive date defaults
- each nonblank notes cell creates one undated note within the batch; preserve line breaks and reference the initial note from the IMPORTED activity
- import honors duplicate choices, including importing a separate application with the same URL or external ID
- duplicate handling never automatically merges, overwrites, or deletes existing applications
- imported records receive activity entries
- a failure on any selected row or its activity rolls back every write in the selected batch, including newly created companies and jobs
- excluded and skipped rows are not committed; successful confirmation reports the number actually imported
- a lost commit response is reported as an unconfirmed outcome, not assumed to mean rollback
- retrying an unconfirmed import uses the same request ID and command, creating no duplicate rows if the original batch committed
- representative fixture tests cover messy real-world rows

**Learning checkpoint**

Explain two-phase preview/commit, idempotency/duplicates, and transaction tradeoffs for batch imports.

## Ticket 7 - MCP server foundation and read tools

**Goal**

Connect Codex to jword through a local bounded tool server.

**Scope**

- TypeScript stdio MCP package/process
- environment validation and owner lock
- private local service-role credential setup per decision 001; no separate email sign-in or user-session login helper
- `search_applications`, `get_application`, `list_application_activity`, and `get_pipeline_summary`
- shared service reuse through `packages/core`, without importing web application source or requiring a running web server
- concise structured outputs
- local setup documentation using current official Codex guidance

**Out of scope**

- mutations
- embedded web chat
- model/provider APIs

**Acceptance criteria**

- Codex discovers the server and tools
- read tools return only owner-scoped data
- invalid input and missing records return typed safe errors
- no secrets or sensitive long-form fields leak into search results/logs

**Learning checkpoint**

Explain MCP transport, tool schemas, discovery, and the complete read call path.

## Ticket 8 - MCP mutation tools and ambiguity evaluations

**Goal**

Complete safe natural-language control through Codex.

**Scope**

- `create_application`
- `update_application_status`
- `update_application_details`
- `add_application_note`
- `update_application_note`
- approval policy/config guidance for writes
- scripted/manual evaluation scenarios for unique, zero, and multiple matches
- mutation activity verification

**Out of scope**

- delete or bulk mutation tools
- in-app chat
- paid model APIs

**Acceptance criteria**

- every mutation requires explicit validated parameters
- existing-record mutations use stable application IDs after lookup (and note IDs for note edits); creation uses a request ID and returns the newly created ID
- unique-match scenarios succeed and log actor `CODEX`
- ambiguous scenarios stop before mutation
- truncated search results never count as evidence of a unique match
- zero-match scenarios never invent records
- owner mismatch and rollback tests pass
- stale-version scenarios re-read and reassess the record rather than blindly retrying the old command

**Learning checkpoint**

Walk through natural language -> Codex reasoning -> tool schema -> validation -> service -> database transaction -> confirmation. Review the highest-risk code together.

## Ticket 9 - Release hardening and handoff

**Goal**

Make the first usable release dependable and understandable.

**Scope**

- targeted Playwright smoke flows
- accessibility and responsive pass
- clean-clone setup verification
- production build/deploy configuration
- backup/export guidance
- documentation reconciliation
- final code review and architecture walkthrough

**Out of scope**

- new product features
- large visual redesign

**Acceptance criteria**

- v1 definition of done is checked item by item
- all automated quality gates pass
- owner can import data, use the tracker, and execute a Codex-driven update
- known limitations and v1.1 candidates are documented

**Learning checkpoint**

Trace both primary runtime paths and identify the files/functions Drew should be able to explain in an interview.

## Recommended first Codex prompt

```text
Read AGENTS.md and every file under docs/. Do not write or modify implementation code yet.

Perform Ticket 0 from docs/IMPLEMENTATION_PLAN.md. Review the proposed v1 architecture for contradictions, unnecessary complexity, missing technical decisions, and security risks. Pay particular attention to:

1. Supabase authentication, RLS, and the local MCP credential path.
2. The web entry point -> shared service -> repository -> database boundary.
3. Atomic application mutations and activity logging.
4. Whether the proposed schema is appropriately scoped for v1.
5. How the stdio MCP package should share domain/service code without creating a messy monorepo.

Return findings grouped as Blocking, Recommended, and Optional. For each finding, give a concrete proposed resolution and tradeoff. End with the exact architecture decisions you recommend we approve before scaffolding. Do not implement anything until I respond.
```
