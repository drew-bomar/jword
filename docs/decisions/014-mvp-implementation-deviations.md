# 014 - MVP implementation deviations

Status: Accepted by the owner on 2026-09-21 (questions answered at the start of the one-shot build).

## Context

The one-shot implementation prompt differed from the planning package in three places. The owner
chose how to resolve each before scaffolding.

## Decisions

1. **Candidate profile is included.** The planning docs deferred `candidate_profiles`; the owner
   chose to follow the implementation prompt instead. The table is one row per user with basic
   identity, contact, portfolio, education, and work-authorization fields, protected by RLS and
   written only through `save_candidate_profile`. It has a minimal settings form at
   `/settings/profile` and no MCP tool. Migration: `supabase/migrations/20260921000300_candidate_profiles.sql`.

2. **Local Supabase for automated verification; hosted for real use.** Decision 004 remains the
   plan for the real tracker, but tests (migrations, RLS, atomicity, retries, Playwright) run against
   a local Supabase stack in Docker so they can be executed without hosted credentials. The same
   migrations are pushed to the hosted project with `supabase db push`. The local database port is
   54329 because 54322 was in use on the owner's machine.

3. **Notes follow decision 012.** The prompt's "editable summary notes" wording is superseded by the
   single Notes section of individually editable, optionally dated notes. There is no summary field.

## Implementation notes recorded here to avoid surprises

- Shared code imports are extensionless and both packages use `moduleResolution: Bundler`. Next.js
  (Turbopack) consumes `packages/core` from TypeScript source via `transpilePackages`; the MCP server
  is bundled with esbuild into a single `dist/index.js` so it runs in plain Node without a build of
  `core`.
- Mutation functions take `(p_owner_id, p_actor, p_request_id, p_command jsonb, p_today date)`. The
  owner is derived from `auth.uid()` for web sessions and must be supplied explicitly by the
  service-role connector. `p_today` carries the owner-timezone date for defaults so the retry
  fingerprint (computed in SQL from `p_command`) reflects caller intent before defaults (decision 011).
- Retry fingerprints are `md5(operation | actor | command jsonb)` computed inside the function; a
  caller cannot supply a hash.
- `[auth.email] enable_signup` must stay `true` in `supabase/config.toml`: it toggles the email
  provider itself. Public sign-up is blocked by the top-level `[auth] enable_signup = false` and by
  `shouldCreateUser: false` in the sign-in action.
