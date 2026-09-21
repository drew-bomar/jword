# jword v1 architecture

## Implementation status (2026-09-21)

Implemented as described below. Concrete locations:

| Layer            | Where                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web entry points | `src/server/actions/*.ts` (Server Actions), `src/server/auth/session.ts` (`requireSession`), `src/proxy.ts` (session refresh + redirect)          |
| MCP entry points | `packages/mcp-server/src/tools.ts` (9 tools), `packages/mcp-server/src/index.ts` (stdio)                                                          |
| Shared services  | `packages/core/src/services/index.ts` (`createTrackerServices`)                                                                                   |
| Validation       | `packages/core/src/validation/schemas.ts` (Zod, strict objects)                                                                                   |
| Repositories     | `packages/core/src/repositories/supabase.ts` (owner-scoped queries + RPC), `types.ts` (contract), `testing/fake-repository.ts` (in-memory double) |
| Database         | `supabase/migrations/20260921000100_schema.sql`, `..._mutation_functions.sql`, `..._candidate_profiles.sql`                                       |
| Import pipeline  | `packages/core/src/import/*` (parse, map, validate, duplicates)                                                                                   |

Deviations from the original plan are recorded in [decision 014](decisions/014-mvp-implementation-deviations.md): the candidate profile is included at the owner's request, and automated tests run against a local Supabase stack while the hosted project remains the real tracker.

## Overview

The design separates language interpretation from application authority.

- Codex interprets Drew's natural-language request.
- The jword MCP server exposes a small set of typed tools.
- A shared application-service layer owns validation and business rules.
- Repository adapters persist data to Supabase Postgres.
- The web UI calls the same services through server-side entry points.

No model runs inside jword in v1.

```mermaid
flowchart TD
    D["Drew"] --> W["jword web UI"]
    D --> C["Codex"]
    W --> E["Web server entry points"]
    C --> M["Local jword MCP server"]
    E --> S["Shared application services"]
    M --> S
    S --> R["Repositories"]
    R --> P["Supabase Postgres"]
```

## Component responsibilities

### Web UI

- render tables, forms, detail views, import flow, and timeline
- collect explicit user input
- display safe validation and operation errors, never raw database error details
- never contain authoritative business rules or secrets

### Web server entry points

Use Next.js Server Actions for web mutations. Next.js handles the browser's HTTP POST request and dispatches it to the action; the browser does not execute database code. Each action verifies the caller and passes a validated command to the shared service. Use Server Components for server-rendered reads through the shared service layer. Reserve Route Handlers for explicit HTTP needs such as an authentication callback; do not create a parallel REST mutation API for the tracker. See [decision 005](decisions/005-web-server-actions.md).

Responsibilities:

- authenticate and authorize the browser session inside each action; a page-level login check does not protect the action by itself
- validate boundary input
- translate transport data into service commands
- call application services
- return serializable results

### MCP server

A local Node/TypeScript stdio process connected to Codex.

Responsibilities:

- declare only the tools in `AI_TOOLING_SPEC.md`
- validate tool input and output
- map tool calls to the shared service layer
- configure the single owner identity from server-only environment
- emit concise structured results

The MCP server must not expose arbitrary SQL, generic HTTP forwarding, shell execution, or a catch-all update function.

### Application services

The most important architectural seam.

Responsibilities:

- enforce required fields and allowed values
- normalize company/title inputs where needed
- resolve interactive date defaults using a shared clock and `JWORD_TIMEZONE=America/Chicago`; preserve unknown imported dates, per [decision 011](decisions/011-date-defaults-and-timezone.md)
- enforce user ownership
- coordinate repository operations
- make primary mutations and activity writes atomic
- preserve request IDs for retry protection; mutation transactions record a receipt and return it on identical retries without repeating writes, per [decision 009](decisions/009-mutation-retry-protection.md)
- require the caller's expected application version for existing-record mutations and translate a database version mismatch into a safe conflict result; see [decision 008](decisions/008-application-version-checks.md)
- return domain-oriented results and typed errors

Example services:

- `searchApplications(query, actor)`
- `createTrackedJob(command, actor)`
- `updateApplicationStatus(command, actor)`
- `updateApplicationDetails(command, actor)`
- `addApplicationNote(command, actor)`
- `updateApplicationNote(command, actor)`
- `previewImport(command, actor)`
- `commitImport(command, actor)`
- `getPipelineSummary(query, actor)`, `getStatusCounts(actor)`
- `getCandidateProfile(actor)`, `saveCandidateProfile(command, actor)`

`actor` includes owner ID and actor type (`USER`, `CODEX`, or `IMPORT`), assigned by the authenticated entry point rather than form/tool arguments. Actor labels describe the application's operational source; they are not cryptographic proof of which program originated a call using the same credential. Database functions independently enforce write invariants because an authenticated caller can invoke an exposed function without going through TypeScript.

### Repositories

- contain Supabase/Postgres queries
- receive explicit `userId` on every operation
- call one narrowly scoped database function for each logical mutation and its activity; do not split those writes across separate requests
- do not make UI or natural-language decisions
- translate database errors into repository errors

### Database

- stores canonical state
- enforces foreign keys, checks, uniqueness where appropriate, timestamps, and RLS
- restricts authenticated web writes to approved functions so direct table calls cannot bypass history, version checks, or retry protection
- uses narrowly scoped Postgres functions called through Supabase RPC (remote procedure call) to save a mutation, its activity, and related timestamps in one transaction; see [decision 002](decisions/002-atomic-mutations.md)

## Runtime paths

### Manual status update

```mermaid
sequenceDiagram
    participant U as Web UI
    participant E as Server entry
    participant S as Application service
    participant R as Repository
    participant DB as Supabase
    U->>E: applicationId + newStatus + expectedVersion + requestId
    E->>E: authenticate + validate
    E->>S: updateApplicationStatus
    S->>R: typed owner-scoped command
    R->>DB: RPC: receipt lookup, version check, update + activity
    DB-->>R: confirmed result or conflict
    R-->>S: domain result
    S-->>E: typed result
    E-->>U: render confirmed state
```

### Natural-language update

```mermaid
sequenceDiagram
    participant D as Drew
    participant C as Codex
    participant M as jword MCP
    participant S as Application service
    participant R as Repository
    participant DB as Supabase
    D->>C: "Move IBM SWE to interview"
    C->>M: search_applications
    M->>S: searchApplications
    S->>R: user-scoped search
    R->>DB: bounded query
    DB-->>R: matching rows
    R-->>S: candidates + versions + pagination
    S-->>M: safe summaries
    M-->>C: candidates + versions + pagination
    alt exactly one unambiguous match, not an incomplete search
        C->>M: update_application_status(id, INTERVIEW, version, requestId)
        M->>S: updateApplicationStatus
        S->>R: typed owner-scoped command
        R->>DB: RPC: receipt lookup, version check, update + activity
        DB-->>R: confirmed result or conflict
        R-->>S: domain result
        S-->>M: safe result
        M-->>C: confirmed change or conflict
    else zero or multiple matches
        C-->>D: report or ask for clarification
    end
```

## Trust boundaries and credentials

Approved on 2026-09-20: keep email sign-in for the hosted tracker and use a private local service-role credential for the MCP connector. See [decision 001](decisions/001-web-and-mcp-access.md). Current review status is in [Ticket 0 final review](TICKET_0_REVIEW.md).

### Browser

- receives only the Supabase public/anon configuration intended for browsers
- signs in through an email link or code on computer or phone; the browser retains the authenticated session, subject to expiry or sign-out
- relies on RLS as a database backstop
- has no direct table-write permission; web mutations reach the approved database functions through Server Actions, shared services, and repositories, per [decision 010](decisions/010-function-only-web-writes.md)

### Next.js server

- uses the authenticated user's Supabase session for tracker operations; the local MCP credential is not used for web requests
- verifies the session and configured owner on every protected operation; provision the owner account directly and disable public self-signup
- keeps authenticated page/data responses out of shared caches and handles session refresh through the supported Supabase SSR integration
- must still pass the authenticated user's ID into services
- must never serialize server secrets to client components

### Local MCP process

- started by Codex through stdio
- receives secrets from local environment, not command-line literals committed to config
- is locked to `JWORD_OWNER_USER_ID`
- uses a Supabase service-role key for this personal local integration; every repository call must explicitly filter by the configured owner and mutation services must verify ownership
- requires no separate email sign-in or user-session login helper
- never returns the credential in tool results or includes it in browser code, logs, or Git
- a leaked service-role key bypasses RLS; document this risk and keep it local/server-only

The owner lock and bounded tools constrain normal connector operations, not the authority of the underlying key. The owner accepts this tradeoff for the personal MVP. A scoped jword access token or user-session flow is deferred.

## Approved workspace structure

Use a pnpm workspace: one repository with a root Next.js application and two related packages. pnpm manages dependencies and project commands with one lockfile. See [decision 003](decisions/003-shared-core-workspace.md).

```text
jword/
  AGENTS.md
  README.md
  docs/
  src/
    app/
    components/
    features/
      applications/
      import/
    server/
      actions/
      auth/
    lib/
      supabase/
  packages/
    core/
      src/
        domain/
        validation/
        services/
        repositories/
    mcp-server/
  supabase/
    migrations/
  tests/
    integration/             # database-backed (local Supabase)
    e2e/                     # Playwright
```

As built, `packages/core` exposes two entry points: `@jword/core/browser` (enums, types, schemas, import helpers; safe for client components) and `@jword/core` (adds services, repositories, and the Supabase client type; server only).

The website and MCP connector both depend on `core`; `core` depends on neither entry point. Keep business rules, shared validation, repository contracts, and the Supabase repository implementation in `core`. Keep cookies, web authentication, and Next.js APIs in the web adapter; keep MCP transport and local credential setup in the connector.

Pass authenticated database clients and actor context into the shared core rather than loading runtime credentials inside it. Expose browser-safe schemas separately from runtime services and repositories. Use explicit package exports and build shared code for standalone Node execution; do not make MCP import the website's source files or depend on a running web server. Keep one lockfile and root scripts, without additional monorepo orchestration tooling.

A future in-app chat or model integration can interpret requests and call the same services through a new adapter. Do not build provider abstractions or model integrations in v1. Public launch would separately require reviewing multi-user authorization, credentials, and AI usage/cost controls.

## Development database

Use one hosted Supabase project for MVP development and real tracker use. The web application can run locally while connecting to that project. A local Supabase stack, Docker, and a separate development database are not required. See [decision 004](decisions/004-hosted-only-development.md).

Keep database changes in checked-in migrations. Validate the initial migrations against the empty hosted project before importing real data; later changes apply incrementally. Verify permissions and atomic behavior with targeted test records or transaction rollback where appropriate, without routine database resets. Unit tests can run without a database.

## Error model

Use typed application errors, including:

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `AMBIGUOUS_MATCH` (normally resolved before a mutation tool)
- `IMPORT_ROW_ERROR`
- `INTERNAL_ERROR`

UI and MCP layers translate these into appropriate human-readable messages without exposing secrets or raw database errors.

## Observability

v1 needs simple structured server logs, not a monitoring platform.

Log:

- operation name
- request/correlation ID
- actor type
- success/failure
- safe record identifiers
- duration

Do not log secrets, full notes, candidate-profile content, or CSV row bodies.

## Architecture decisions before scaffolding

All five choices below and the product decisions in records 006-013 are approved. See [Ticket 0 final review](TICKET_0_REVIEW.md). Scaffolding is the next ticket and has not started.

1. **Approved:** Next.js Server Actions for web mutations, with shared service reuse; see [decision 005](decisions/005-web-server-actions.md).
2. **Approved:** one hosted Supabase project for MVP development and real use; no required local database or Docker setup. See [decision 004](decisions/004-hosted-only-development.md).
3. **Approved:** narrowly scoped Postgres functions called through Supabase RPC, with the mutation and activity in one transaction; see [decision 002](decisions/002-atomic-mutations.md).
4. **Approved:** pnpm workspace with the root web application, `packages/core`, and `packages/mcp-server`; see [decision 003](decisions/003-shared-core-workspace.md).
5. **Approved:** email-authenticated web sessions and a private local MCP service-role credential, as described in [decision 001](decisions/001-web-and-mcp-access.md).

These choices must preserve the contracts above.
