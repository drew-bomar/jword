# Watchlist architecture walkthrough (JWO-16)

A 90-minute session to understand the company watchlist: what it stores, how one save travels
from the browser to Postgres and back, and how it prepares for job discovery without doing any.
Read top to bottom. Open the linked files when a section points at them.

Terms used below:

- **ATS**: applicant tracking system. Greenhouse, Lever, and Ashby host companies' public job
  boards.
- **RLS**: Row Level Security. Postgres rules that limit which rows a signed-in user can see.
- **RPC**: remote procedure call. Here, asking Postgres to run a named function through Supabase.
- **FK**: foreign key. A column that must point at an existing row in another table.
- **MCP**: Model Context Protocol. How a coding agent (Codex or Claude Code) calls jword's tools.
- **Idempotent**: safe to repeat. Retrying the same request does not apply it twice.

---

## 1. Overview and boundaries (10 min)

**In plain language.** The watchlist is a list of companies whose public job boards jword
should check _later_. For each company it stores which ATS hosts the board and the board's
name, for example Greenhouse + `stripe`. It also stores whether monitoring is active. That is
all. Nothing fetches jobs, nothing runs on a timer, and nothing ranks anything.

**Where it sits in the discovery roadmap** ([decision 018](decisions/018-company-watchlist.md)):

```text
1. Watchlist            ← this ticket: which boards to read (owner-edited configuration)
2. Board collection     ← next: read those boards' public APIs
3. Leads inbox          ← discovered postings, filtering, promote to application
4. Maybe grading        ← undecided
```

**Boundaries.** A watch is not an application and not a job. Adding one never creates or
changes applications. Configuration (watches) stays separate from the future results (postings
and leads), so collection can fail, retry, or be redesigned without touching what the owner
curated.

**Component map.**

```text
Browser                                  Local agent (Codex / Claude Code)
  /watchlist page (Server Component)       │
  WatchForm, WatchStatusButton (client)    │ stdio
        │ Server Action POST               ▼
        ▼                                MCP server: watchlist-tools.ts
  src/server/actions/watchlist.ts          (actor fixed to owner + CODEX,
  (requireSession + owner lock)             service-role client)
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
        packages/core: createWatchlistServices  ← Zod schemas, no business logic in UI
                       ▼
        SupabaseTrackerRepository (owner-scoped queries + RPC)
                       ▼
        Postgres: public.create_company_watch / update_company_watch /
                  set_company_watch_active  (security definer wrappers)
                       ▼
        jword.* private implementations: watch row + company fields +
        audit row + version + retry receipt, one transaction
```

**The files most worth reading, in order:**

1. `supabase/migrations/20260922000100_company_watchlist.sql`: tables, constraints, RLS, the three functions.
2. `packages/core/src/watchlist/boards.ts`: `inferBoardFromUrl`, `canonicalBoardUrl`.
3. `packages/core/src/watchlist/schemas.ts`: `addWatchedCompanySchema`, `checkBoardShape`.
4. `packages/core/src/services/watchlist.ts`: `createWatchlistServices`.
5. `packages/core/src/repositories/supabase.ts`: `listWatches`, `mutateWatch`.
6. `src/server/actions/watchlist.ts`: `addWatchAction`.
7. `src/features/watchlist/watch-form.tsx`: `applyPastedUrl`, `submit`, the stale/duplicate flows.
8. `packages/mcp-server/src/watchlist-tools.ts`: the five tools.
9. `packages/core/src/testing/fake-repository.ts`: `createWatch` (the SQL rules, in TypeScript, for unit tests).

---

## 2. Schema, composite owner FK, RLS, grants, audit (15 min)

**Two tables and a view.**

- `company_watches`: one row per watched company. `provider`, `board_identifier`, `board_url`,
  `active`, `version`.
- `company_watch_activities`: the audit trail. One row per create, update, deactivate, or
  reactivate.
- `company_watch_overview`: a read-only view joining each watch with its company name, interest,
  website, notes, application count, and latest audit entry. The page and MCP read from it.

**Why a separate table instead of columns on `companies`?** Hundreds of companies exist only
because a CSV import created them. Putting watch columns on every company mixes "who this
employer is" with "whether I monitor its board". It would also make "one watch per company" a
convention instead of a constraint. The separate table gets its own version, its own history,
and its own uniqueness rules. The cost is one join, which the view hides.

**The composite owner FK.** Look for `company_watches_company_owner_fkey`:

```sql
foreign key (user_id, company_id) references public.companies (user_id, id)
```

A plain FK on `company_id` would only prove the company _exists_. Including `user_id` proves it
belongs to _the same owner_ as the watch. That matters because the MCP server uses a
service-role key that bypasses RLS: even a bug in TypeScript cannot link your watch to someone
else's company. The database refuses (SQLSTATE `23503`). `companies` already had
`unique (user_id, id)` to make this possible; jobs use the same pattern.

**Other constraints that encode rules:**

- `unique (user_id, company_id)`: one watch per company, active or inactive.
- Unique index on `(user_id, provider, lower(board_identifier))`: one board per owner, so
  collection never reads the same board twice under two names.
- `company_watches_board_shape` check: supported providers must have a well-formed identifier
  and exactly the canonical URL; `OTHER` must have no identifier.

**RLS and grants.** The same rule as the rest of jword ([decision 010](decisions/010-function-only-web-writes.md)):

- `authenticated` can `select` its own rows (policy `(select auth.uid()) = user_id`).
- `anon` and `authenticated` have **no** insert/update/delete grants at all.
- Every write goes through three `security definer` functions. They run with the function
  owner's rights, so each one resolves and checks the owner explicitly (`jword.resolve_owner`)
  instead of trusting RLS.

**Audit.** `application_activities` requires an application id, so watch events get a sibling
table with the same shape. Metadata stores changed field names and scalar before/after values.
Company notes are recorded only as "companyNotes changed", never their text.

---

## 3. Trace: "add from a pasted URL" (20 min)

This is the full runtime path for one save. Follow it in the code.

**Step 1: browser, pure inference.** In `watch-form.tsx`, typing into "Board or careers URL"
calls `applyPastedUrl`, which calls `inferBoardFromUrl` from `@jword/core/browser`:

```text
"https://job-boards.greenhouse.io/stripe/jobs/6523462?gh_jid=6523462"
  → { provider: "GREENHOUSE", boardIdentifier: "stripe",
      boardUrl: "https://job-boards.greenhouse.io/stripe" }
```

It is a pure function: host lookup, first path segment, pattern check. No network call. The form
fills Provider and Board identifier; the owner can still change them. A URL on an unknown host
becomes provider `OTHER` with that careers URL. Nothing is saved yet.

**Step 2: browser, the command.** On submit, `submit()` builds a command. Board fields go
through `boardFields()`: supported providers send an identifier and no URL, and `OTHER` sends
only the careers URL. Blank company fields are omitted so they cannot wipe an existing company's
values. `useReliableMutation().save` adds a `requestId` (a fresh UUID) and **keeps this exact
command** until the result is known.

**Step 3: Server Action.** `addWatchAction` in `src/server/actions/watchlist.ts`:

1. `requireSession()` verifies the Supabase session with the auth server and builds
   `{ userId, actorType: "USER" }`. The browser never chooses the actor.
2. `servicesFor(session)` builds services on a repository bound to the user's own client (RLS
   applies).
3. Calls `addWatchedCompany`, then `revalidatePath("/watchlist")`.
4. `runAction` turns any `JwordError` into a serializable `{ ok: false, error }`, including
   `watchId`/`watchActive` for conflicts.

**Step 4: shared service.** `createWatchlistServices().addWatchedCompany` parses with
`addWatchedCompanySchema`. It rejects unknown keys, requires a company name or id, and applies
`checkBoardShape`. Then it calls `repository.createWatch` and logs the operation name, ids, and
duration (never notes).

**Step 5: repository.** `SupabaseTrackerRepository.mutateWatch` calls
`rpc("create_company_watch", { p_owner_id, p_actor, p_request_id, p_command })`. Undefined keys
are stripped so "absent" and "null" stay different. Database errors with SQLSTATE `JW4xx` map to
typed errors in `repositories/errors.ts`.

**Step 6: Postgres, public wrapper.** `public.create_company_watch`:

1. `jword.resolve_owner(p_owner_id)`: with a web session, `auth.uid()` wins and a mismatched
   owner is `FORBIDDEN`; the service role must pass an explicit owner.
2. `jword.validate_watch_command`: repeats the input rules for callers who skip TypeScript.

**Step 7: Postgres, private implementation.** `jword.create_company_watch`, all in one
transaction:

1. `begin_request`: if a receipt exists for this `(owner, requestId)` with the same fingerprint,
   return the saved result marked `replayed`. A different command under that id is
   `REQUEST_ID_REUSED`.
2. Company: an explicit `companyId` must belong to the owner; otherwise insert-or-reuse by
   normalized name (decision 013). Remember whether it was created.
3. Existing watch for that company? → `JW409 ALREADY_WATCHED` with `{ watchId, watchActive,
currentVersion }`.
4. `resolve_board_url` computes the stored URL; `assert_board_free` rejects a board already
   watched for another company.
5. Insert the watch. A concurrent duplicate that slips past step 3 hits the unique index, which
   the exception handler reports as the same conflict.
6. `apply_company_fields` writes interest/website/notes onto the company if they changed.
7. `add_watch_activity` inserts `WATCH_CREATED`.
8. `finish_request` stores the receipt and returns the result.

If any step raises, **everything** rolls back: the new company, the watch, the audit row, and
the receipt.

**Step 8: back to the browser.** Success → toast "Started watching Stripe (Greenhouse)", the
dialog closes, and `router.refresh()` re-renders the Server Component list from
`company_watch_overview`. An `ALREADY_WATCHED` error becomes the "Already on your watchlist"
alert with a Reactivate button.

---

## 4. Deactivate/reactivate, version conflicts, and retries (10 min)

**Deactivate.** `WatchStatusButton` sends `{ watchId, expectedVersion, active: false }` to
`setWatchStatusAction` → `setCompanyWatchStatus` → `set_company_watch_active`. The function:

1. checks the receipt,
2. `lock_watch` takes the row lock (`for update`) and compares `version` with `expectedVersion`,
3. if already in that state, stores a no-op receipt and changes nothing else,
4. otherwise flips `active`, bumps `version`, and writes `WATCH_DEACTIVATED`.

Only the watch row changes. The company, its applications, and all history stay.

**Version conflicts ([decision 008](decisions/008-application-version-checks.md)).** Two tabs
both loaded version 2. Tab A deactivates (version 3). Tab B saves an edit with
`expectedVersion: 2` and gets `CONFLICT / STALE_VERSION`. The comparison happens inside the
locked transaction, so there is no gap between "check" and "write". In the edit form, the draft
is kept: "Refresh latest values" re-renders with version 3, and "Reapply my edits" puts only the
fields you changed on top of the latest values.

**Retries ([decision 009](decisions/009-mutation-retry-protection.md)).** If the network drops
after the database committed, the browser cannot tell whether the save happened. The attempt in
`src/lib/mutations/attempt.ts` keeps the original command and `requestId`, locks the form, and
offers "Retry original save". The retry hits the receipt and gets the first result back
(`replayed: true`). The change is never applied twice.

---

## 5. Provider representation, URL inference, and the adapter seam (10 min)

**Representation.** Provider is an enum (`GREENHOUSE | LEVER | ASHBY | OTHER`) in Postgres and
in `domain/enums.ts`. The identifier is the one value a collector needs. The URL is _derived_
from provider + identifier for supported providers, so the two can never disagree; the check
constraint enforces it. `OTHER` exists so the owner can watch a company with no supported board
now, and upgrade it later without losing history.

**Inference rules** (`boards.ts`): recognized hosts are `boards.greenhouse.io`,
`job-boards.greenhouse.io`, `boards-api.greenhouse.io/v1/boards/{token}`, `jobs.lever.co`, and
`jobs.ashbyhq.com`. Job paths, queries, and fragments are ignored. It rejects Greenhouse's
`embed` pages, lookalike hosts (`greenhouse.io.evil.com`), non-http schemes, and identifiers
outside the conservative pattern. It returns `null` rather than guessing.

**The adapter seam (next ticket, not built).** Decision 018 sketches:

```ts
interface BoardAdapter {
  provider: SupportedBoardProvider;
  listPostings(board: { boardIdentifier: string }): Promise<BoardPosting[]>;
}
```

One adapter per provider in core. `fetch` is injected so tests stay offline. A "Verify board"
action would call `listPostings` for one watch and report reachability without saving anything.
Collection would loop over active watches. Its state (last checked, errors) goes in its own
table, not on `company_watches`.

---

## 6. MCP tool path and the owner lock (10 min)

`packages/mcp-server/src/watchlist-tools.ts` registers five tools: `list_watched_companies`,
`get_watched_company`, `add_watched_company`, `update_watched_company`, and
`set_company_watch_status`. From the service call onward, the path is identical to the web.

What is different, and why it is still safe:

- **Credential.** The MCP process uses the service-role key, which bypasses RLS.
- **Owner lock.** The actor is fixed at startup to `{ userId: JWORD_OWNER_USER_ID, actorType:
"CODEX" }`. Tools never accept a user id.
- **Defense in depth.** Every repository query filters `user_id = owner`, and every function
  checks ownership again. A valid UUID of another user's watch returns `NOT_FOUND`, and the
  composite FK blocks cross-owner links even if code is wrong.
- **Strict schemas.** Unknown fields are rejected by the SDK before the handler runs.
- **Protocol (AGENTS.md, item 9).** Read first, act on one `watchId`, send `version` and a new
  `requestId`, and never guess among companies. On `ALREADY_WATCHED`, offer reactivation.

---

## 7. Tests, failure cases, and security checks (10 min)

| Layer    | File                                          | What it proves                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure     | `packages/core/test/watchlist-boards.test.ts` | every URL shape; 17 rejects                                                                                                                                                                                                                                                             |
| Service  | `packages/core/test/watchlist.test.ts`        | schemas; add new/existing; decision-013 spelling; foreign company id; `ALREADY_WATCHED` incl. inactive; board clash; update allowlist; switch to OTHER; no-op; stale version; deactivate preserves data; replay and `REQUEST_ID_REUSED`; audit-failure rollback; filters and pagination |
| MCP      | `packages/mcp-server/test/watchlist.test.ts`  | tool list; CODEX actor; notes never echoed; conflicts; foreign watch id; retries                                                                                                                                                                                                        |
| Database | `tests/integration/watchlist.test.ts`         | RLS isolation; anon denied; direct writes denied; composite FK `23503`; unique `23505`; board-shape check `23514`; direct-RPC validation writes nothing; injected audit failure rolls back watch + new company + receipt; MCP owner lock                                                |
| Browser  | `tests/e2e/watchlist.spec.ts`                 | pasted-URL add; edit; two-tab stale edit; deactivate; duplicate → reactivate; existing-company reuse; phone cards                                                                                                                                                                       |

The fault-injection test is worth reading. It installs a temporary trigger that makes the audit
insert fail, then shows that the watch _and the company created in the same call_ are gone.
That is atomicity proven against the real database.

---

## 8. Key invariants and tradeoffs

Invariants (each enforced in the database, not only in TypeScript):

1. A watch and its company always have the same owner (composite FK).
2. At most one watch per company, and one company per board, per owner (unique keys).
3. A supported-provider watch always has a valid identifier and its canonical URL (check).
4. Every successful change has exactly one audit row, one version bump, and one receipt, in the
   same transaction.
5. Browsers cannot write tables; only the three functions can.
6. Nothing is ever deleted by the product.

Tradeoffs:

- **Company fields edited through the watch.** Interest, website, and notes are not copied, so
  there is one source of truth. The watch version guards them, which is correct only while the
  watchlist is their only editor.
- **Derived board URL.** It removes a class of inconsistency but cannot store unusual board
  hosts. Those fall back to `OTHER`.
- **One watch per company.** It keeps the UI and agent protocol simple. A company with two
  boards needs a later change to the unique key.
- **SQL mirrors TypeScript** (pattern, URL builder, validation). The mirror exists because
  direct RPC callers can skip TypeScript. Both sides are tested.

**How this prepares for Leads without implementing them.** Leads will need a stable source
(`watch_id`), a company to attach to (`company_id`), and an owner-safe way to link them (the
same composite FK pattern). All three now exist. Promoting a lead will reuse
`createApplication`. None of those tables or tools exist yet.

---

## 9. Review questions (5 min)

1. Why include `user_id` in the watch → company foreign key when `company_id` is already unique?
2. An add creates a new company, then its audit insert fails. What happens to that company?
3. Tab A deactivates a watch while tab B has the edit dialog open. What does tab B see on save,
   and what happens to its typed changes?
4. The response to "Add to watchlist" is lost after the database committed. What does the owner
   click, and why is a second watch not created?
5. Why is `board_url` rejected when sent with provider `LEVER`?
6. An agent calls `set_company_watch_status` with another user's valid watch UUID. Which layers
   stop it?
7. Why does adding "stripe" when an _inactive_ Stripe watch exists fail instead of silently
   reactivating?
8. Where would a "Verify board" button's logic live, and what must it not do?

<details>
<summary>Answers</summary>

1. A plain FK proves the company exists; the composite FK proves it belongs to the same owner.
   The MCP key bypasses RLS, so this is the database-level guarantee against cross-owner links.
2. It is rolled back with everything else in the transaction: company, watch, audit row, and
   receipt. The integration test "an audit-row failure rolls back…" checks this.
3. `CONFLICT / STALE_VERSION`. The form keeps the draft. "Refresh latest values" loads the new
   version, "Reapply my edits" places the changed fields on top, and saving then succeeds.
4. "Retry original save". The retained command reuses the same `requestId`; the function finds
   the receipt and returns the original result with `replayed: true`.
5. Supported providers derive their URL from the identifier; accepting a second URL would allow
   the two to disagree. The service and SQL return `BOARD_URL_DERIVED`, and the check
   constraint would reject it anyway.
6. The repository filters by the configured owner, and `lock_watch` looks up
   `(owner, id)`, so the call gets `NOT_FOUND`. The composite FKs block any cross-owner link
   even if code were wrong.
7. Reactivating changes monitoring. The owner should choose it explicitly; the error carries the
   `watchId` and version so the UI and agent can offer it in one step.
8. In the watchlist service, calling a core `BoardAdapter.listPostings`. It must not store
   postings, create leads, or run on a schedule; those belong to later tickets.

</details>

---

## Manual verification checklist

The full numbered steps are in [MANUAL_VERIFICATION.md](MANUAL_VERIFICATION.md#company-watchlist-decision-018).
Short version:

- [ ] Watchlist link in the header opens the empty state.
- [ ] Pasting a Greenhouse job URL fills Greenhouse + `stripe`; the save shows an Active row.
- [ ] A careers URL on another host becomes Other; an existing company can be picked.
- [ ] Edit interest/notes → row and "Updated watch" line change.
- [ ] Two-tab edit conflict keeps the draft and saves after "Reapply my edits".
- [ ] Deactivate/Reactivate flip the state (icon + word); applications are unchanged.
- [ ] Adding the same company again offers "Reactivate it" and never creates a second row.
- [ ] Phone width shows cards and no sideways scrolling.
- [ ] After `supabase db push` on hosted, the page loads with your real data.
