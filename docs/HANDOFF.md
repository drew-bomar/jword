# jword MVP handoff

Original build: 2026-09-21 on branch `claude/mvp`. Verification below describes that build; see the reliability corrections in ARCHITECTURE.md for the 2026-09-22 follow-up. This is the engineering and learning handoff for the owner.

## Reliability follow-up (2026-09-22)

The four review gaps are addressed: uncertain saves retry the identical command, conflict refreshes
preserve drafts, all three web lists have pagination, and direct database calls validate their input.
Shared date rules and documentation now reflect the approved implementation.

The runtime path remains **web form / MCP tool → shared service → repository → database transaction**.
The transaction still saves the record, activity and retry receipt together. A receipt lets a repeated
request return its original result without applying the change twice.

Files worth understanding:

- `src/lib/mutations/attempt.ts`: holds the original command and request ID until the result is known.
- `src/features/applications/application-form.tsx`: keeps drafts while showing newer saved values.
- `packages/core/src/domain/date-policy.ts`: interactive date defaults shared with the service tests.
- `supabase/migrations/20260921000500_validate_commands.sql`: guards direct database calls too.

Design tradeoff: essential validation remains in both TypeScript and SQL, since direct database
callers can bypass the service. SQL also retains the rules that must run with the locked record.
Unconfirmed requests stay in browser memory; resolve them before leaving or reloading the page.

Local environment caveats: the installed PostgREST v16.2 intermittently rejects a newly issued
sign-in token after idle (`PGRST303`), consistent with [upstream issue 5196](https://github.com/PostgREST/postgrest/issues/5196).
Browser tests perform a database readiness read before minting the token; application failures are
still asserted without retries. The local dependency itself has not been upgraded.
The default Turbopack build hit an OS port restriction; the supported webpack build was verified.

Verification: `pnpm check` passed formatting, lint, all TypeScript checks and 110 unit tests;
`pnpm test:integration` passed 29 tests; `pnpm test:e2e` passed 23 browser tests with three
intentional mobile skips; `pnpm mcp:build` and `pnpm build --webpack` passed. Browser regressions
cover lost responses after committed creates/imports, two-tab conflicts, retained note drafts,
and application/note/activity pagination. Database checks cover direct input rejection without
writes and counts/duplicate probes beyond 1000 rows. No hosted environment was exercised.

Migration 005 was applied only to local Supabase. Hosted deployment and Linear tickets are unchanged.
For manual acceptance, check a two-tab edit conflict, an interrupted save and retry, and the More/First
links with enough applications, notes or activity. See [MANUAL_VERIFICATION.md](MANUAL_VERIFICATION.md).

## Outcome

Everything in the MVP definition of done works against the local Supabase stack: authentication,
migrations, RLS, the applications tracker, detail page with notes and timeline, two-phase CSV import,
candidate profile, the shared service layer, and the MCP server with read and mutation tools. The
unit, integration, and Playwright suites, lint, typecheck, format check, and the production build pass.

Remaining external steps are the owner's: create the hosted Supabase project and push the migrations,
put the values in `.env.local` / Vercel, and register the MCP server with Codex or Claude Code
(`docs/MCP_SETUP.md`). None of these blocked verification because the same migrations and code were
exercised locally.

## Runtime paths

**Manual web mutation** (example: inline status change)

1. `InlineStatusSelect` (client) calls `updateStatusAction({ requestId, applicationId, expectedVersion, status })`.
2. `src/server/actions/applications.ts` → `requireSession()` verifies the Supabase session with the auth
   server and builds `{ userId, actorType: "USER" }`. Form data never chooses the actor.
3. `servicesFor(session)` builds the shared services on a repository bound to the user's own client.
4. `services.updateApplicationStatus` validates with the strict Zod schema, resolves "today" in
   `America/Chicago`, and calls the repository.
5. `SupabaseTrackerRepository.mutate` calls RPC `update_application_status(p_owner_id, p_actor,
p_request_id, p_command, p_today)`.
6. The Postgres function resolves the owner from `auth.uid()`, checks the retry receipt, locks the row,
   compares the version, writes the row + activity + version + receipt in one transaction, and returns JSON.
7. Errors come back as SQLSTATE `JW4xx`; the repository maps them to `JwordError`; the action returns a
   serializable `{ ok:false, error }`; the UI shows a toast or the stale-edit alert.

**MCP mutation** is the same from step 4 onward. Steps 1-3 are replaced by
`packages/mcp-server/src/tools.ts`: the SDK validates the strict tool schema, the actor is fixed to
`{ userId: JWORD_OWNER_USER_ID, actorType: "CODEX" }`, and the repository uses the service-role client.
Because that key bypasses RLS, every query filters by `user_id` and the function still verifies
ownership, so a UUID belonging to another user yields `NOT_FOUND`.

## Security boundaries

- Browser: anon key only, session cookie, RLS on every table, no table write grants at all.
- Next.js server: verifies the session per action; optional `JWORD_OWNER_USER_ID` lock; never
  serializes secrets to client components (`@jword/core/browser` is the only core entry the client uses).
- Database: `security definer` wrappers with fixed `search_path` in `public`, helpers in the private
  `jword` schema, execute revoked from `anon`/`public`, explicit owner checks inside every function.
- MCP: service-role key from env or an untracked env file, owner verified at startup, stdout reserved
  for the protocol, structured logs on stderr without note text or CSV rows.

## Verification (2026-09-21, local Supabase stack)

| Command                      | Result                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`          | clean                                                                                                                               |
| `pnpm lint`                  | clean                                                                                                                               |
| `pnpm typecheck`             | clean (web, core, mcp-server)                                                                                                       |
| `pnpm test:unit`             | 7 files, 103 tests passed                                                                                                           |
| `pnpm test:integration`      | 5 files, 24 tests passed                                                                                                            |
| `pnpm test:e2e`              | 13 passed, 3 skipped (desktop-only specs on the mobile project)                                                                     |
| `pnpm mcp:build`             | bundle at `packages/mcp-server/dist/index.js`                                                                                       |
| `pnpm build`                 | production build succeeds                                                                                                           |
| MCP over stdio (real owner)  | tools/list 9 tools; search, pipeline summary, unique status update (CODEX activity), identical-retry replay, stale-version CONFLICT |
| Browser walkthrough (Chrome) | sign-in via magic link, create, inline status, dated note, timeline, table, import and profile pages                                |

`docs/MANUAL_VERIFICATION.md` is the owner's acceptance walkthrough.
