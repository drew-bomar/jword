# 027 - Public sign-up with owner-only discovery features

Status: Proposed 2026-10-16 (implementation handoff `docs/MULTI_USER_HANDOFF.md`; owner decisions
recorded there). Amends the one-owner mission in `AGENTS.md`, the web owner lock described in
`docs/ARCHITECTURE.md`, and the extension distribution in decisions 016/017. Decisions 018-026
(watchlist, discovery, collection, Leads, search preferences) are unchanged but become
owner-only.

## Context

jword was built for one person. The web app refuses every account except
`JWORD_OWNER_USER_ID`, and sign-in never creates accounts. The owner now wants other people to use
the tracker and, above all, the Chrome extension's job capture. Discovery (watchlist, board
discovery, "Check for new jobs", Leads, search preferences) is paused and may be abandoned; it
also makes outbound requests to job boards from jword's server, so it is not opened to the
public.

The data layer was already per user: every user-owned table has `user_id` with owner-only Row
Level Security, writes go only through SQL functions that refuse an actor other than the signed-in
user, uniqueness is per user, and every `user_id` references `auth.users` with
`on delete cascade`. Opening sign-up therefore changes access rules in the web layer, not the
schema.

## Decision

### Two kinds of signed-in user

- **Anyone with an account** gets Applications, Import, Profile, and extension job capture.
- **The discovery user** (the owner) also gets Watchlist, Leads, "Check for new jobs", and
  Search preferences.

`JWORD_OWNER_USER_ID` keeps its name and changes meaning from "the only user allowed in" to "the
user with discovery features". Renaming it or making it a list is deferred until a second
discovery user exists. The MCP server is unchanged: it still requires this variable and acts
only as that user. There is no public MCP.

**Fail closed.** When the variable is unset, nobody has discovery features. Local development
and browser tests set it explicitly (the Playwright server uses a fixed test id and its fixture
creates the discovery user with that id).

### One server-side check, enforced at every entry point

`canUseDiscovery(session)` in `src/server/auth/session.ts` is the only place that decides.
`requireDiscoverySession()` wraps `requireSession()` and throws `NOT_FOUND` for everyone else, so
discovery looks absent rather than forbidden. It guards:

- pages `/watchlist`, `/leads`, `/settings/preferences` (Next.js `notFound()`)
- Server Actions in `src/server/actions/{watchlist,leads,preferences}.ts`
- Route Handlers `/api/watchlist/{boards,companies,suggestions}`
- extension endpoints `/api/extension/{add-watch,verify-boards,search-companies}`

Hiding links (nav, Leads → preferences) is presentation only. The extension asks the server
which features the signed-in user has rather than deciding locally.

**What the gate protects.** The gate controls jword's server: outbound board requests and the
owner-only screens. It is not a data boundary. A signed-in user who calls Supabase directly
with the public anon key and their own session could still write watchlist rows for themselves,
because RLS allows a user to manage their own rows. That only affects their own data and triggers
no outbound requests (collection runs only through the gated server path). A database-level
capability (a `discovery_users` table checked in SQL functions) would close this but adds a
migration for little benefit while discovery is paused; revisit if discovery is ever offered to
other users.

### Open sign-up

Sign-in creates an account on first use (`shouldCreateUser: true`) with the existing 6-digit
email code flow. The copy is the same for new and returning addresses ("We sent a code to …"), so
the form does not reveal whether an address already has an account. The `/forbidden` page and
the FORBIDDEN redirect are removed because no signed-in user is refused anymore.

Hosted setup belongs to the owner: enable email sign-up in Supabase Auth, configure custom SMTP
(Supabase's built-in sender only reaches project members and a few emails per hour), upload
`supabase/templates/magic_link.html`, and set Site URL and redirect URLs for the production
domain. Supabase rate-limits code requests per address; CAPTCHA is added only if abuse appears.

### Extension for other people

Specified in the extension slice of the handoff and recorded here when built: the production
origin becomes the default server and a fixed host permission; the server accepts a short list of
extension ids (`JWORD_EXTENSION_IDS`, keeping `JWORD_EXTENSION_ID`) so the unpacked zip and a
Chrome Web Store build both work; signed-out and discovery-unavailable states are shown in the
overlay.

### Privacy and accounts

A public `/privacy` page states what is stored and how to request deletion (needed for a Web
Store listing). Deleting a user in Supabase Auth removes all their rows by cascade; a
self-service delete is deferred and the owner's manual process is documented.

## Known limitations

- `JWORD_TIMEZONE` (America/Chicago) still sets "today" defaults for every user. A per-user time
  zone is deferred.
- The discovery gate is a server gate, not a database rule (see above).
- One discovery user. A list is a small change in one function when needed.

## Consequences

- Positive: other people can sign up and capture jobs with no schema change; isolation keeps
  relying on the RLS and function-only writes that integration tests already cover.
- Positive: one function decides discovery access, so adding or removing a gated surface is a
  one-line change at that entry point.
- Negative: every new discovery entry point must remember to call `requireDiscoverySession`.
  Integration and browser tests check each existing one for a second user.
- Negative: open sign-up depends on hosted email setup the code cannot verify.
