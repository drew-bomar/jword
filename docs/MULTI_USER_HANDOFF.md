# Handoff: public jword (Applications, Import, Profile, Chrome extension)

Written 2026-10-16 from a read-only review of `main` at 84d2754 (after PR #6). Nothing has been
changed yet. Read AGENTS.md first; it describes jword as a one-owner tracker, and this work
changes that contract, so write ADR 027 and get the owner's OK on the plan before building.

## Owner decisions (2026-10-16)

- **Public scope:** anyone who signs up gets **Applications, Import, Profile, and the Chrome
  extension's job capture**. Watchlist, Leads, Check for new jobs, and Search preferences stay
  **owner-only** (they may be abandoned later; do not delete them).
- **Sign-up:** open sign-up preferred. Invite-only is an acceptable first step only if open
  sign-up turns out materially harder. With job collection owner-only, open sign-up has low cost.
- **MCP:** stays a local, owner-only tool. No public MCP.
- **Extension:** must be available to others and work well. This is the priority.

Still to ask the owner (do not guess): extension distribution (recommend an unlisted Chrome Web
Store item; alternative is a zip for Developer mode), the email provider and sender address, and
the production URL the extension should default to (currently `https://jword.vercel.app`).

## Already multi-user safe (verified)

- Every user-owned table has `user_id` and owner-only RLS; writes go only through SQL functions;
  `jword.resolve_owner` refuses an owner id that differs from the signed-in user. Unique rules are
  per user. Integration tests already check cross-user denial (`tests/integration/rls.test.ts`).
- Web requests use the signed-in user's Supabase session (`src/server/auth/session.ts`).
- The extension API authenticates with the user's own session cookie plus the extension `Origin`
  check (`src/server/extension-origin.ts`); nothing ties it to the owner.

## Blockers today

1. **Sign-in never creates accounts.** `requestSignInCode` (`src/server/actions/auth.ts`) uses
   `shouldCreateUser: false`; its error says "not registered as the owner". Local
   `supabase/config.toml` has top-level `[auth] enable_signup = false`; the hosted project very
   likely matches (owner checks Dashboard → Authentication → sign-up toggle).
2. **Production owner lock.** Vercel Production sets `JWORD_OWNER_USER_ID` (confirmed with
   `vercel env ls`), so `requireSession` sends everyone else to `/forbidden`.
3. **Email.** Supabase's built-in email only reaches project team members and is limited to a few
   per hour. Configure custom SMTP in the hosted project and upload the existing template
   (`supabase/templates/magic_link.html`).
4. **Extension distribution.** Loaded unpacked; default server `http://localhost:3200`; fixed host
   permissions are localhost only (`https://*/*` is optional, requested at runtime). A Web Store
   item gets a different extension id (the manifest `key` is removed for upload; the private key
   for the current id was not kept), but the server accepts one `JWORD_EXTENSION_ID`.

## Planned work (small, reviewable slices)

### 1. Access and feature gating (ADR 027)

Change the meaning of the owner setting from "the only user allowed in" to "the user with
discovery features":

- `requireSession` stops rejecting other users. Add one server-side capability check, e.g.
  `canUseDiscovery(session)` = `user.id === JWORD_OWNER_USER_ID` (consider renaming the variable
  to `JWORD_DISCOVERY_USER_IDS`, a comma list, keeping the old name working). Keep it in one place.
- Enforce it **on the server**, not only by hiding links:
  - pages `/watchlist`, `/leads`, `/settings/preferences` → not-found for others
  - Server Actions in `src/server/actions/watchlist.ts`, `leads.ts`, `preferences.ts`
  - Route Handlers `src/app/api/watchlist/{boards,companies,suggestions}`
  - extension endpoints `src/app/api/extension/{add-watch,verify-boards,search-companies}`
    (the remaining five are the public capture flow)
- Hide the Watchlist and Leads nav links (`src/components/nav-links.tsx`) and any links to them
  (Leads page links to preferences; applications may link to Leads after "Create application").
- Profile save currently re-evaluates leads (`services/index.ts` → `reevaluateLeads`); harmless for
  users with no leads, but confirm it is a no-op and cheap.
- MCP keeps requiring `JWORD_OWNER_USER_ID` (`packages/mcp-server/src/env.ts`); unchanged.

### 2. Open sign-up

- `requestSignInCode`: `shouldCreateUser: true`; neutral copy ("We sent a code to …"), no
  "owner" wording; same flow for new and returning users. Update `/sign-in` and `/forbidden` text.
- Hosted Supabase (owner actions): enable email sign-up, configure SMTP, set Site URL and
  redirect URLs, keep the 6-digit code flow; consider CAPTCHA (Supabase supports hCaptcha /
  Turnstile) if sign-up abuse appears. Supabase also rate-limits OTP sends per email.
- First-run experience: empty Applications page should point to "New application", Import, and
  installing the extension.
- Only after this ships: decide whether to keep `JWORD_OWNER_USER_ID` in Vercel (needed for the
  owner's discovery features under the new meaning).

### 3. Extension for other people (priority)

- Default server: the production origin (keep localhost selectable in Options for development).
- Permissions: add the production origin as a fixed host permission; drop optional
  `https://*/*` if the store review objects (job-site reading uses `activeTab` + `scripting`).
- Hide or disable "Watch this company" for users without discovery (have the overlay ask the
  server for capabilities, or treat a 403/404 from `add-watch` as "not available" with clear copy).
- Server accepts a small list of ids (`JWORD_EXTENSION_IDS`: current unpacked id + store id) in
  `extensionOrigin`/`checkExtensionRequest`.
- Signed-out state: the overlay should say "Sign in to jword" with a link that opens the
  production sign-in page, then work after sign-in (check cookies: the extension worker fetch
  sends the user's jword cookie only with host permission for that origin).
- Packaging: a build without the manifest `key` for the store; store listing text, icons,
  screenshots, and a privacy policy URL (next item). Update `packages/extension/README.md`.

### 4. Privacy policy and account basics

- A short `/privacy` page: what is stored (applications, notes, profile, captured postings), that
  nothing is sold or shared, how to request deletion. Needed for a Web Store listing.
- Account deletion: deleting the auth user should cascade (tables reference `auth.users` with
  `on delete cascade`; verify before relying on it). A self-service "Delete my account" is
  optional for v1; at minimum document the owner's manual process.

### 5. Global settings that become per-user later (document, do not build yet)

`JWORD_TIMEZONE` (America/Chicago) sets "today" defaults for everyone. Fine for a first public
version; note it in the ADR as a known limitation.

## Verification to plan

- Integration: a second user signs up and can use applications, import, and profile; cannot read
  or change the owner's data; gets FORBIDDEN/NOT_FOUND from every watchlist, lead, preference
  action and endpoint; the owner still can.
- Playwright: new-email sign-up on the local stack (Mailpit at 127.0.0.1:54324 shows the code);
  nav shows only Applications, Import, Profile for the new user; direct URLs to /watchlist,
  /leads, /settings/preferences are not found; owner flows still pass.
- Extension: second Chrome profile, signed in as the new user, captures a job into their account;
  "Watch this company" is not offered; signed-out state is clear.
- Production: a second real email after SMTP is configured.

## Environment notes

- Tests use the local stack via `.env.test.local`; never run them against hosted. `.env.local`
  points at the hosted project.
- Port 3200 is the owner's `next dev`; Next 16 allows one `next dev` per folder, so browser tests
  run against `JWORD_E2E=1 next build --webpack` (output `.next-e2e`) served on 3100, with
  `.env.test.local` exported before building (NEXT_PUBLIC values are inlined at build time).
- Hosted migrations (likely none for this work) are applied by the owner with
  `pnpm exec supabase db push`. Supabase Auth settings, SMTP, Vercel env changes, and the Chrome
  Web Store account are owner actions.

## Progress (branch `claude/multi-user`)

- 2026-10-16: ADR 027 written. Slices 1 (discovery gate) and 2 (open sign-up, code side) built:
  `canUseDiscovery` / `requireDiscoverySession` / `requireDiscoveryPageSession` in
  `src/server/auth/session.ts`; `/forbidden` removed; nav filtered; `shouldCreateUser: true` with
  neutral copy; local `[auth] enable_signup = true` and `enable_confirmations = true` with a
  `confirmation.html` template (a brand-new address receives the "Confirm signup" template, not
  `magic_link`, so both must show `{{ .Token }}`). Discovery pages are soft 404s (the root
  `loading.tsx` streams first, so the status is 200 with `noindex`). Tests: unit
  `src/server/auth/session.test.ts`, browser `tests/e2e/multi-user.spec.ts` (Playwright now runs
  with a fixed discovery user id, `tests/e2e/helpers/discovery.ts`).
- Owner, hosted setup for slice 2 (after buying the domain):
  1. Resend (or similar): add and verify the domain (SPF/DKIM DNS records in Cloudflare).
  2. Supabase → Authentication → Emails → SMTP: Resend host/port/user/API key, sender e.g.
     `auth@<domain>`, sender name `jword`.
  3. Supabase → Authentication → Emails → Templates: paste `supabase/templates/confirmation.html`
     into "Confirm signup" and `magic_link.html` into "Magic Link" (subject "Your jword sign-in
     code" for both).
  4. Supabase → Authentication → Sign In / Providers: allow new users to sign up (email); keep
     "Confirm email" on.
  5. Supabase → Authentication → URL Configuration: Site URL `https://<domain>`; redirect URLs
     `https://<domain>/auth/callback` and `https://jword.vercel.app/auth/callback`.
  6. Vercel: add the domain to the project. Keep `JWORD_OWNER_USER_ID` (it now grants discovery).
- Next: slice 3 (extension) needs the production domain.
