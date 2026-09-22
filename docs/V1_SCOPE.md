# jword v1 scope

## Single objective

Replace Drew's Google Sheet with a database-backed job tracker that Drew can edit manually and Codex can manipulate through explicit, safe tools.

## In scope

### Foundation

- Next.js/TypeScript application
- Supabase project integration
- authentication for one owner account
- database migrations, generated types, and Row Level Security
- local web development against a local Supabase stack (Docker) for automated tests, and the hosted Supabase project for real use; deployment-ready environment configuration

### Tracker

- applications list with search, filter, and sort
- create and edit application/job data, including selection or creation of the associated company; no separate company-management workflow
- inline status and priority updates
- application detail view
- one Notes section with individual editable notes (date labels removed in decision 015); additions and edits generate activity history automatically
- activity timeline
- basic stage counts

### Migration

- CSV upload, column mapping, validation preview, duplicate warnings, confirmation, and result summary
- sample/template CSV and import documentation

### Codex tooling

- local TypeScript MCP server using stdio
- bounded read and mutation tools defined in `AI_TOOLING_SPEC.md`
- shared service layer used by both web and MCP entry points
- explicit owner scoping, validation, audit logging, and ambiguity-safe behavior
- setup instructions for connecting the server to Codex

### Quality

- unit/service tests for core rules
- targeted hosted-database integration tests for permissions, atomic mutations, version conflicts, and retries
- a few Playwright smoke tests for the most important manual flows
- lint, typecheck, test, and build scripts

## Explicitly out of scope

- embedded chat UI
- OpenAI, Anthropic, or other paid model API calls
- user-supplied API keys
- personalized job recommendations
- automatic job discovery or scraping
- automated job submission
- Chrome/browser autofill extension
- resume generation or tailoring
- interview-preparation workspace
- Gmail, Outlook, calendar, Slack, or notification integrations
- networking/contact CRM
- file attachments and resume binary storage
- automatic email parsing
- vector database, embeddings, or RAG
- background workers, queues, Redis, microservices, or Kubernetes
- complex analytics, forecasting, streaks, or gamification
- teams, collaboration, roles, billing, subscriptions, or public onboarding
- native mobile application
- one-click destructive bulk actions

## Guardrails against scope creep

- A minimal candidate profile (one table, one settings form, no MCP tool) was added on 2026-09-21 at the owner's request for the one-shot build; see [decision 014](decisions/014-mvp-implementation-deviations.md). Recommendations and autofill remain out of scope.
- Activity history is required; generalized event sourcing is not.
- Basic counts are allowed; a separate analytics product is not.
- MCP tools are required; a custom agent runtime or in-app interpreter is not.
- Responsive usability is required; a separately designed mobile app is not.
- Deployment readiness is required; production SaaS hardening for unknown users is not.

## Definition of done

v1 is complete when all of the following are true:

1. The owner can sign in and no other account can access the data.
2. The existing CSV can be previewed, validated, and imported without manual row re-entry.
3. Applications can be created, found, filtered, sorted, updated, and viewed in detail.
4. Status and note changes create accurate activity entries.
5. Core mutations go through the shared service layer.
6. Codex can connect to the local jword MCP server and perform the documented tool flows.
7. Ambiguous natural-language requests result in clarification rather than mutation.
8. No LLM provider API key is required by jword.
9. RLS tests or equivalent verification prove cross-user reads/writes are blocked.
10. Formatting, lint, typecheck, tests, and production build pass.
11. README setup instructions work from a clean clone.
12. Drew receives a final architecture walkthrough and code-review checklist.

## Deferred decision triggers

Revisit these only when the trigger occurs:

| Decision                               | Trigger                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Embedded chat/provider abstraction     | The terminal/Codex workflow is proven and an in-app chat is still valuable                                         |
| Candidate profile                      | An approved job-recommendation or application-autofill feature needs reusable candidate information                |
| Job recommendations                    | The tracker is stable and the owner wants help finding suitable opportunities; define profile requirements then    |
| Application autofill/browser extension | Repeatedly entering application information becomes a priority; design the candidate profile alongside the feature |
| Interview workspace                    | Interview volume makes separate preparation state useful                                                           |
| Email/calendar integration             | Manual timeline upkeep becomes unreliable                                                                          |
| Multi-user/SaaS architecture           | A real second user is invited                                                                                      |
