# jword MVP handoff

Original build: 2026-09-21 on branch `claude/mvp`. Verification below describes that build; see the reliability corrections in ARCHITECTURE.md for the 2026-09-22 follow-up. This is the engineering and learning handoff for the owner.

## Board discovery (JWO-16 follow-up, 2026-09-23)

[Decision 019](decisions/019-board-discovery.md). Branch `claude/board-discovery`, stacked on
`claude/jwo-16-company-watchlist`. Adding a company now looks up its boards: saved application
links plus the public Greenhouse, Lever, and Ashby APIs. Results are ranked with reasons and
strong matches are pre-ticked; the owner confirms. A company can have up to three boards
(`company_watch_boards`, capped by the database). "Suggest from applications" watches
already-applied companies in one step. MCP gains `discover_company_boards` and
`suggest_watches_from_applications`.

Hosted step (owner): `pnpm exec supabase db push` applies `20260923000100_watch_boards.sql`,
which moves existing boards into the new table. Then deploy; the old page code does not work
after this migration, so push and deploy together.

## Company watchlist (JWO-16, 2026-09-22)

[Decision 018](decisions/018-company-watchlist.md). Branch `claude/jwo-16-company-watchlist`.
The owner can list, search, filter, add, edit, deactivate, and reactivate watched companies at
`/watchlist`. Each watch records a Greenhouse, Lever, Ashby, or Other board configuration. It is
configuration only: nothing fetches, stores, schedules, or ranks postings. The 90-minute study
guide is [WATCHLIST_ARCHITECTURE_WALKTHROUGH.md](WATCHLIST_ARCHITECTURE_WALKTHROUGH.md).

Runtime path: `WatchForm` → `addWatchAction` (`requireSession`) → `addWatchedCompany` (Zod) →
`SupabaseTrackerRepository.createWatch` → `public.create_company_watch` → `jword.create_company_watch`
(company match-or-create, watch row, audit row, receipt in one transaction). MCP tools call the
same services with actor `CODEX`.

Hosted step (owner): migration `20260922000100_company_watchlist.sql` was applied only to the
local stack. Apply it to hosted with `pnpm exec supabase db push` (the repo is already linked),
then deploy. The page errors until the migration exists on hosted.

Verification (local stack): `pnpm check` (197 unit tests), `pnpm test:integration` (39),
`pnpm test:e2e` (34 passed, 14 intentional desktop/mobile skips), `pnpm mcp:build`,
`JWORD_E2E=1 pnpm build --webpack`, and a stdio smoke of the built MCP server (14 tools, add +
list, CODEX audit). No hosted data was touched and no external service was called.

Found while testing: the tracker's Edit details dialog cannot be reopened after a save until the
page reloads (its busy flag stays set when the form unmounts). The watchlist dialogs reset it;
the tracker fix is a separate one-line change.

## In-page capture overlay (2026-09-22)

[Decision 017](decisions/017-extension-overlay-capture-api.md) replaces the side panel below with a
Jobright-style panel drawn inside the job tab. The panel is an extension page inside a closed shadow
root, pinned right and pushing the page over. It talks only to the background worker. The worker
calls five origin-restricted JSON endpoints with the owner's normal cookie. A spike confirmed first
that Chrome sends the SameSite=Lax cookie on the worker's fetch when the extension has host
permission. It sends `Origin` only on POST, so every endpoint is POST.

Runtime path: toolbar click → extractor + overlay host (job tab) → overlay frame (nonce) →
`chrome.runtime` message → background worker → `POST /api/extension/*` → Origin check →
`requireSession` → Zod → shared service → database function (record + activity + version +
receipt in one transaction).

Files worth understanding:

- `src/server/extension-origin.ts` + `extension-api.ts`: the Origin check (the CSRF defense), then
  session, then one service call per endpoint in `src/app/api/extension/*/route.ts`.
- `packages/extension/src/background.ts`: capture, the nonce check on every overlay message, and
  the only network path (`api.ts`, which turns a lost save into `OUTCOME_UNKNOWN`).
- `packages/extension/src/overlay-host.ts`: closed shadow root, iframe, page push, and close.
- `src/features/capture/capture-review.tsx`: the review UI, now taking a `CaptureApi`; bundled
  into the extension with jword's UI kit and Tailwind theme (`packages/extension/build.mjs`).

Bundle trim (same day, after owner testing): the overlay went from 813 KB to 353 KB and the worker
is 92 KB. The posting is normalized in the worker; core has `"sideEffects": false`; all Zod imports
use `import * as z from "zod"` (the named `{ z }` import kept every Zod locale, about 450 KB).

Owner setup: set `JWORD_EXTENSION_ID=bnjlbmpmikpggohfhmfpddeeokbjpkbk` in `.env.local` and in
Vercel, restart, `pnpm ext:build`, and reload the unpacked extension. Its id changes because of
the pinned key, so remove the old card and load it again.

Verification: `pnpm check` (142 unit tests), `pnpm test:integration` (29; one failure on the first
run after idle, then two clean reruns), `pnpm test:e2e` (31 passed, 11 intentional mobile skips),
`pnpm mcp:build`, and `pnpm build --webpack` into `.next-e2e`. No hosted data was touched. Gaps:
the hosted https origin was not exercised live (same Chrome host-permission rule as localhost). The
overlay is not yet tested on live LinkedIn/Greenhouse pages; see MANUAL_VERIFICATION.md.

## Browser extension capture (2026-09-22) — superseded in part by 017

Branch `claude/extension-capture`, [decision 016](decisions/016-browser-extension-capture.md). A
Chrome extension reads a job posting and opens jword's `/capture` page, where the owner reviews it
and creates a new application or explicitly updates a matching one. Hosted Supabase received
migration 005 the same day (owner-run `supabase db push`; row counts unchanged).

Runtime path: toolbar click → `packages/extension` extractor in the job tab → Chrome side panel
framing `/capture?embed=1` → `postMessage` handoff → Zod-validated preview → `createApplicationAction` or
`updateDetailsAction` → shared service → database function. No new mutation service, RPC, route
handler, migration, or credential.

Files worth understanding:

- `packages/core/src/capture/plan.ts`: which posting fields a capture may write and what is
  pre-selected (blanks yes, overwrites no; never status/priority/company/title).
- `src/features/capture/capture-workspace.tsx`: match choice, per-field update plan, stale-version
  refresh, reuse of the reliable-mutation hook.
- `packages/extension/src/background.ts` and `panel.ts`: activeTab extraction, side panel, and the
  origin-restricted `postMessage` handoff to the framed page.
- `packages/extension/src/extract/index.ts`: adapter → JSON-LD → meta merge with guess flags.

Design tradeoff: the preview is jword's own page framed in the side panel, so the extension needs
no API or credentials and the existing Server Action/session/retry path is reused. Chrome does not
keep cookies set inside that frame, so signing in happens in a normal tab. New captures default to
status APPLIED.

Verification: `pnpm check` (129 unit tests), `pnpm test:integration` (29), `pnpm test:e2e` (31
passed, 5 intentional skips; includes loading the built extension into Chromium and a sign-in
redirect), `pnpm mcp:build`, `pnpm build --webpack`. Extractors were run against live Greenhouse,
Lever, Ashby, Workday, and LinkedIn pages. Gaps: LinkedIn's "About the job" did not render in the
automation tab, so LinkedIn description capture is unverified live; the sign-in form's `next`
redirect (code entry) is covered only manually. See the extension checklist in
[MANUAL_VERIFICATION.md](MANUAL_VERIFICATION.md).

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
