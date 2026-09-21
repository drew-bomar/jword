# Ticket 0 - Final architecture review

Reviewed: 2026-09-21. Planning review complete; implementation has not started.

## Outcome

The owner approved the five deliberate architecture choices and all discussed product decisions. No further pre-scaffolding product decisions are pending. The plan keeps a personal tracker, one hosted database, a website, a later local connector, and a shared core. Candidate profiles and model integrations remain future work.

## Blocking findings - resolved in the plan

| Finding | Resolution | Tradeoff |
| --- | --- | --- |
| Credential and ownership boundaries were ambiguous | Email-authenticated web sessions; private local service-role credential with explicit owner scope for MCP. Disable public self-signup and verify web sessions/owner. [001](decisions/001-web-and-mcp-access.md) | The accepted local credential bypasses RLS; a leaked key retains broad authority. |
| Direct web writes could bypass history and rules | Deny direct authenticated table writes; grant only approved mutation functions, with explicit authorization inside privileged implementations. [010](decisions/010-function-only-web-writes.md) | Additional database permission configuration; SQL must enforce essential invariants independently of TypeScript. |
| Ownership could be inconsistent across related rows | Composite owner-and-record foreign keys cover companies, jobs, applications, notes, and activities. Verify constraints directly. [Schema](DATABASE_SCHEMA.md) | A few additional constraints/indexes. |
| Multi-part writes, stale edits, and retries were undefined | Database transactions couple state/history; versions reject stale edits; request receipts prevent repeated effects. [002](decisions/002-atomic-mutations.md), [008](decisions/008-application-version-checks.md), [009](decisions/009-mutation-retry-protection.md) | Small SQL operations, version fields, and an internal receipt table. |
| MCP could become coupled to Next.js source | Root web application plus shared core and later MCP package in one pnpm workspace. [003](decisions/003-shared-core-workspace.md) | A small package build step, without additional orchestration tooling. |

## Recommended findings - resolved or assigned to bounded tickets

| Finding | Resolution | Tradeoff |
| --- | --- | --- |
| Web transport undecided | Server Actions call shared services; Next.js handles the HTTP connection. [005](decisions/005-web-server-actions.md) | Web adapters depend on Next.js, but core services do not. |
| Development setup too heavy for this owner | One hosted Supabase project for development and real use; retain migrations and targeted tests. [004](decisions/004-hosted-only-development.md) | Tests need network access and development errors can affect real records. |
| Duplicate imports conflicted with uniqueness rules | Warn and allow explicit skip/import-separately choices; URLs/external IDs are non-unique. Selected imports are all-or-nothing. [006](decisions/006-import-duplicate-choices.md), [007](decisions/007-atomic-import-batches.md) | Deliberate duplicates remain possible; a failing row aborts the selected batch. |
| Dates, notes, and company matching were unclear | Central-time defaults, blank unknown imported dates, one editable Notes section with optional date labels, conservative company matching. [011](decisions/011-date-defaults-and-timezone.md), [012](decisions/012-single-notes-section.md), [013](decisions/013-conservative-company-matching.md) | Historical dates require explicit input; alternate company names may remain separate. |
| Tool and document contracts had gaps | Creation uses request IDs rather than nonexistent record IDs; pagination exposes truncation; note edits have a specific tool; diagnostics use stderr. [Tooling](AI_TOOLING_SPEC.md) | Slightly more explicit tool inputs/results. |
| Profile scope and form requirements contradicted implementation scope | Defer candidate profiles entirely. Require user-entered company/title only; other controls are optional or defaulted. Persist personal communication preferences in AGENTS.md. | Future profile features need their own schema and interface. |

## Optional findings - deferred

Realtime subscriptions, fuzzy company aliases, separate company-management screens, model-provider abstractions, event sourcing, queues, and extra workspace tooling are not required. Existing optional company metadata columns do not authorize additional product workflows. Add capabilities only when their future ticket justifies them; this avoids speculative feature work.

The schema now contains five tracker tables (companies, jobs, applications, notes, activities) and one internal retry-receipt table. Notes and receipts directly support approved behavior; candidate-profile storage does not.

## Learning checkpoint

Website -> authenticated Server Action -> shared service -> repository -> transactional database function.

Codex -> local MCP handler -> the same shared service -> repository -> the same database functions.

Codex interprets intent; that interpretation is not authority to mutate arbitrary records. Explicit commands, ownership checks, versions, and database constraints determine whether a write succeeds. The local administrator credential remains the explicitly accepted exception to database-enforced credential scope.

## Verification and limits

- Re-read AGENTS.md, the six planning specifications, and the decision records; reconciled their current contracts.
- Checked local Markdown links, formatting, resolved-decision references, and stale requirements. No implementation tests, build, migrations, or application security tests have run because implementation does not exist yet.
- Verified access to the Linear jword workspace and Jword team. After the review, at the owner's explicit request on 2026-09-21, created the `jword v1` project and all ten issues. Verified their descriptions, statuses, and sequential dependencies; links are in the [implementation plan](IMPLEMENTATION_PLAN.md#linear-tickets).
- Preserve the owner's existing README.md changes and unrelated files. No credentials were added or exposed.

Implementation tickets must verify the promises: direct-write denial and cross-owner rejection in Ticket 2/3; atomic rollback, versions, and retries in Ticket 3; import rollback/retry and realistic size limits in Ticket 6; ambiguity and bounded tool behavior in Tickets 7/8. Limits, SDK/package versions, and concrete build configuration are implementation details to validate in their tickets, not additional product decisions now.

## Next step

On the owner's instruction, start [Ticket 1 (JWO-6)](https://linear.app/jword/issue/JWO-6/ticket-1-scaffold-the-application-and-quality-gates): scaffold the web/shared-core foundation and quality commands. The Linear project and issues are already created. Do not implement the database or MCP package in Ticket 1.
