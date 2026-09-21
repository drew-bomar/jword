# jword

`jword` is a personal, database-backed job-application tracker that can be updated manually through a fast web UI or through safe natural-language commands issued to Codex.

## v1 outcome

Replace the current spreadsheet with a reliable tracker that supports:

- adding and editing job opportunities/applications
- status, priority, dates, notes, search, filtering, and sorting
- CSV import from the existing Google Sheet
- an immutable activity timeline for important changes
- bounded MCP tools that let a locally authenticated Codex session read and update the same data

The web app does **not** call OpenAI or Anthropic APIs in v1. Natural-language interpretation happens in Codex, which calls explicit jword tools. This avoids a separate model API bill while the project is for personal use, subject to the owner's existing Codex plan limits.

## Start here

1. Read `AGENTS.md`.
2. Read all files under `docs/`.
3. Perform the requested pre-implementation design review.
4. After approval, execute one issue from `docs/IMPLEMENTATION_PLAN.md` at a time.

## Documents

- `docs/PRODUCT_SPEC.md` - user problem, workflows, and product requirements
- `docs/V1_SCOPE.md` - hard boundaries and definition of done
- `docs/ARCHITECTURE.md` - components, trust boundaries, and runtime paths
- `docs/DATABASE_SCHEMA.md` - proposed Supabase/Postgres schema and policies
- `docs/AI_TOOLING_SPEC.md` - safe MCP tool contracts and agent behavior
- `docs/IMPLEMENTATION_PLAN.md` - ordered, small Linear-ready tickets

## Status

Planning package complete. No implementation decisions should be treated as irreversible until Codex completes the initial design review and the owner approves the findings.
