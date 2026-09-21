# jword MVP handoff

Built 2026-09-21 on branch `claude/mvp`. This is the engineering and learning handoff for the owner.

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
