# jword

`jword` is a personal, database-backed job-application tracker. It replaces a Google Sheet with:

- a fast manual web UI (Next.js App Router + Supabase), and
- a local **MCP server** that lets a coding agent (Codex or Claude Code) read and update the same
  data through a small set of bounded, audited tools.

No model API runs inside jword. Natural-language interpretation happens in the coding agent; jword only
exposes explicit tools, validates every input, and writes through transactional database functions.

## Architecture in one paragraph

Both entry points call the same shared services in `packages/core`:

```
Web UI ──► Server Action ──┐
                           ├──► shared service ──► owner-scoped repository ──► Postgres function
Coding agent ──► MCP tool ─┘                                                   (one transaction:
                                                                                rows + activity +
                                                                                version + receipt)
```

- **Web**: the browser only ever holds the public anon key; every query runs under the signed-in user's
  session, so Row Level Security applies. Authenticated users can _read_ their rows but cannot write
  tables directly; writes go through approved `security definer` functions.
- **MCP**: a local stdio process that uses a private service-role key from its environment, locked to
  `JWORD_OWNER_USER_ID`. The key bypasses RLS, so the repository filters every query by owner and every
  function verifies ownership again.
- **Atomicity**: each mutation (create, status change, detail edit, note add/edit, import batch) is one
  Postgres function that commits the primary rows, the activity entry, the version bump, and a retry
  receipt together, or rolls all of them back.

See `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/AI_TOOLING_SPEC.md`, and
`docs/decisions/` for the full design. `docs/MCP_SETUP.md` covers agent registration and
`docs/MANUAL_VERIFICATION.md` the acceptance walkthrough.

## Repository layout

```
src/                     Next.js app (pages, Server Actions, auth plumbing, UI components)
  app/                   routes: /, /applications/new, /applications/[id], /import, /settings/profile, /sign-in
  server/actions/        Server Actions: authenticate → validate → shared service → safe result
  server/auth/           requireSession(): verifies the Supabase session, builds the actor context
  features/              UI for applications, import, profile, auth
packages/core/           shared domain types, Zod schemas, CSV import pipeline, services, repositories
packages/mcp-server/     local stdio MCP server (bundled to dist/index.js)
supabase/migrations/     schema, RLS, grants, and the mutation functions
tests/integration/       database-backed tests (RLS, atomicity, retries, MCP path, import)
tests/e2e/               Playwright smoke flows
scripts/create-owner.ts  provisions the single owner account
```

## Prerequisites

- Node 20+ and pnpm (`npm i -g pnpm`)
- Docker (for the local Supabase stack used in development and tests)
- Optional: `psql` for poking at the local database

## Setup from a clean clone

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the local Supabase stack (first run downloads Docker images):

   ```bash
   pnpm db:start
   ```

   This applies every migration in `supabase/migrations/`. Print the local keys with:

   ```bash
   pnpm exec supabase status -o env
   ```

3. Create `.env.local` from `.env.example` and fill in the local values:

   | Variable                        | Value from `supabase status`          |
   | ------------------------------- | ------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | `API_URL`                             |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY`                            |
   | `SUPABASE_URL`                  | `API_URL`                             |
   | `SUPABASE_SERVICE_ROLE_KEY`     | `SERVICE_ROLE_KEY` (server-side only) |
   | `SUPABASE_DB_URL`               | `DB_URL` (integration tests only)     |
   | `JWORD_OWNER_EMAIL`             | your email                            |

4. Provision the owner account (public sign-up is disabled):

   ```bash
   pnpm owner:create
   ```

   Copy the printed id into `JWORD_OWNER_USER_ID` in `.env.local`. The web app then rejects any other
   account, and the MCP server is locked to that owner.

5. Run the app:

   ```bash
   pnpm dev
   ```

   Open http://localhost:3000/sign-in, enter the owner email, and use the one-time code from the local
   inbox at http://127.0.0.1:54324 (Mailpit).

## Commands

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `pnpm dev`              | Next.js dev server                                              |
| `pnpm build`            | production build                                                |
| `pnpm check`            | format check + lint + typecheck + unit tests                    |
| `pnpm test:unit`        | Vitest unit tests (no database)                                 |
| `pnpm test:integration` | Vitest tests against the local Supabase stack                   |
| `pnpm test:e2e`         | Playwright smoke flows (starts its own dev server on port 3100) |
| `pnpm db:start/stop`    | local Supabase stack                                            |
| `pnpm db:reset`         | drop and re-apply all migrations locally                        |
| `pnpm db:types`         | regenerate `packages/core/src/db/database.types.ts`             |
| `pnpm mcp:build`        | bundle the MCP server to `packages/mcp-server/dist/index.js`    |
| `pnpm owner:create`     | create or look up the owner account                             |

## Connecting a coding agent

Build the server, then register it with Codex or Claude Code as described in `docs/MCP_SETUP.md`.
The server needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWORD_OWNER_USER_ID`, and optionally
`JWORD_TIMEZONE`, supplied through the environment or an untracked file referenced by `JWORD_ENV_FILE`.
Never put the service-role key in committed config.

## Using a hosted Supabase project

The same migrations apply to a hosted project:

1. Create a project at supabase.com and note the project ref.
2. Disable public sign-up: Authentication → Sign In / Providers → Email → turn off "Allow new users to
   sign up" (keep the Email provider enabled), and add your site URL and `/auth/callback` to the
   redirect allow-list. Optionally replace the Magic Link email template with
   `supabase/templates/magic_link.html` so the email includes the one-time code.
3. Link and push the migrations:

   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```

4. Point `.env.local` (and, for deployment, Vercel environment variables) at the hosted URL, anon key,
   and service-role key, then run `pnpm owner:create` once against it. Keep the local stack values in
   `.env.test.local`: the test suites read that file first and refuse to run against a hosted URL.

## Security notes

- `.env*` files are git-ignored; only `.env.example` is committed.
- The service-role key is used only by the local MCP process and the owner script. It never reaches the
  browser bundle or the Next.js client.
- Logs contain operation names, ids, actor types, and durations, never note text, CSV rows, or secrets.
- There is no delete anywhere in the product; history is append-only through the mutation functions.
