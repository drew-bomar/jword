# 026 - Search preferences and deterministic lead filtering

Status: Accepted by the owner on 2026-09-27 (implementation handoff "editable search
preferences and deterministic lead filtering"; plan approved with: excluded existing leads get a
Filtered out view, newest first stays the default sort, role interest never affects ordering).
Builds on decision 024. The final deterministic layer before agent assessment; no LLM, MCP tools,
or grading are added.

## Context

Collection (024) saves every posting on every watched board. On real boards most postings are
sales, recruiting, senior, or management roles: a live read of seven boards on 2026-09-27 found
Stripe 549 of 701, Datadog 380 of 449, and Salesforce 1,224 of 1,521 clearly outside a new-grad
engineering search. The owner needs those gone without losing anything uncertain, and later wants
an agent to assess what remains.

Central rule: **unknown means eligible, with an uncertainty flag.**

## Decision

### Preferences are configuration, separate from the profile

`search_preferences` (one row per owner, versioned, owner-only RLS, function-only writes) holds
target level (`NEW_GRAD` | `ANY`), employment target (`FULL_TIME` | `ANY`), preferred start month,
ordered preferred cities (keys of a documented catalog, at most 10), hide-remote-only, preferred
and de-emphasized role families, and an optional posting-age limit (off by default).
`save_search_preferences` replaces the whole set with an expected version (none on the first
save), a request-id receipt, and a `search_preference_activities` audit row, in one transaction.

The graduation date is **not** copied: the evaluator reads `candidate_profiles.graduation_date`,
so there is one source of truth. Nothing is hardcoded for the owner; with no saved row the
evaluator receives `preferences: null` and nothing is excluded, even with a saved graduation
date. The owner enters values once at
`/settings/preferences`.

### One pure evaluator (`packages/core/src/leads/evaluate.ts`)

`evaluatePosting(posting, { preferences, graduationDate, key })` returns:

- `match`: `ELIGIBLE`, `UNCERTAIN` (eligible with flags), or `EXCLUDED`
- `exclusions` and `flags`, each `{ code, field, evidence }` (the text that matched)
- labels: `arrangement` (onsite/hybrid/remote/unknown) and the field it came from, matched
  preferred `cities` and `cityRank`, `roleFamilies` and `roleFit`, stated `startMonth` and
  `startFit`

Hard rules (the only exclusions): explicit internship/co-op (title or structured employment
type); clearly senior title (senior, sr, staff except "Member of Technical Staff", principal,
distinguished, lead, level IV+, Salesforce SMTS/LMTS/PMTS); people management (executives, or a
manager of an engineering team); a clearly non-engineering title with no strong engineering word;
and a graduation window, only when exactly one explicit, mandatory range is parsed and it
excludes the owner's graduation month. Optional preferences, historical hiring statements,
negation, and alternative experience qualifications stay uncertain.

Conservative by construction: seniority and management read only the title (descriptions
mention senior colleagues and leading projects); an either-level title ("Solution
Architect/Senior Solution Architect") is flagged; weak technical words (AI, data, platform,
technical) never make a sales or recruiting title eligible, but also never exclude an unfamiliar
title on their own; technical-adjacent titles (technical program/account manager, solutions
consultant/architect) are flagged; experience numbers ("5+ years") are flagged, never excluded.

Flags: level unclear (Engineer III, either-level), occupation unclear, graduation unclear
(ambiguous, conflicting, or no profile date), experience mentioned, contract/part-time/temporary,
and outside the US (eligibility is assumed for US jobs for matching only; nothing about
citizenship, clearance, or sponsorship is inferred or written to the profile).

Labels never exclude. Remote-only comes from a structured provider field, or from locations in
which every comma-separated segment says remote or names a region ("Remote (US)", "California -
Remote"); a location that also names an office ("US-Remote, Chicago, Seattle") is not
remote-only; negated remote text and onsite/remote contradictions also cannot establish
remote-only work. Descriptions are never read for it. Cities use a small alias catalog
(`preferences/cities.ts`) across every listed location.

The collector now also reads structured fields where providers publish them: Ashby
`employmentType`, `workplaceType`, and `secondaryLocations` (its `isRemote` is ignored because it
is true on hybrid roles); Lever `categories.commitment`, `categories.allLocations`, and
`workplaceType`. Unexpected shapes become null and never invalidate a posting.

### Where the rules apply

Evaluation is computed in TypeScript and **stored** on each lead (`match_status`, `arrangement`,
`city_rank`, `role_fit`, `evaluation` jsonb, `evaluation_key`) so views, sorting, and paging run
in SQL.

- **Collection.** Each check reads preferences and the graduation date once (one snapshot for
  every board). `record_lead_postings` receives each posting with its evaluation: a **new**
  posting evaluated `EXCLUDED` is not stored and is counted on `lead_scans.filtered_count` /
  `filtered_reasons` by primary reason; a **known** posting is always refreshed and re-evaluated.
  Filtering never touches availability: only a complete scan marks unseen postings unavailable, and
  "filtered out" never means closed.
- **Re-evaluation.** `evaluation_key` = evaluator version + preferences version + graduation
  month. After a preference save, a profile save, and at the end of every check, leads with a
  different key are re-evaluated in pages of 250 through `apply_lead_evaluations`, which refuses a
  stale preferences version (`STALE_PREFERENCES`) or graduation date (`STALE_PROFILE`). Each row
  also supplies its `expectedInputRevision`: a database trigger increments this separate counter
  when posting inputs change, and an outdated result is skipped. Preference/profile saves and
  evaluation writes serialize per owner, including when no settings row exists yet. This avoids
  first-save overwrites and stale evaluations without changing the lead's review version.
  Re-evaluation changes evaluation columns only: never review status, availability, or rows.
- **Reading.** `listLeads` views: **Recommended** (default: not excluded; without remote-only
  when the owner hides them; posting-age limit), **Remote only**, **Filtered out** (existing
  leads the current rules exclude), **All**. Sort: newest first (default) or preferred city
  first. Role filter: preferred only, or hide de-emphasized. The age limit keeps undated postings
  (all Workday postings).

Limitation (shown in the UI): postings skipped under earlier preferences were never stored, so
after loosening preferences they appear only on the next check.

### Room for agent assessment

The evaluator's output shape (decision, findings with field and evidence) is the contract an
agent assessment would extend. `UNCERTAIN` leads are the natural queue. A later
`lead_assessments` table would hold agent output separately, never overwriting the deterministic
columns. No MCP lead tools are added here.

## Why not other approaches

- **Evaluate in SQL.** The rules are text heuristics that change often and need thorough unit
  tests; one TypeScript function serves collection, re-evaluation, and later agents. SQL
  validates the stored shape and enforces ownership and the stale-version guard.
- **Evaluate only when reading.** Paging, counts, and sorting by city would need every lead in
  memory on each page load.
- **Store excluded new postings too.** It keeps thousands of irrelevant rows (and descriptions)
  per check; the owner chose counts only. Existing leads are never dropped.
- **Bump lead versions on re-evaluation.** Evaluation is derived data; bumping would make an open
  Dismiss fail with STALE_VERSION after every preference edit.
- **A fit score.** Deliberately none: a number implies precision the rules do not have.

## Tradeoffs and limits

- Rules are English-title heuristics tuned on seven real boards; unfamiliar titles stay (flagged).
  Sales engineers stay because "engineer" is a strong signal. A few either-level titles joined
  with "&" are treated as senior.
- The outside-US flag uses state names/codes and the city catalog; "Vancouver, BC, CA" reads as
  US (CA) and unlisted US cities without a state are flagged.
- Re-evaluation runs inside the Server Action that saved preferences; thousands of leads take a
  few seconds. A failure there is logged and returned as `reevaluationPending`; the form explains
  that preferences committed and asks for another save to retry. No-op saves and identical
  request replays repair stale labels without adding another preference activity. Controls stay
  locked while a save is pending or its response is unconfirmed.
- Settings writes and each evaluation batch briefly serialize per owner. This trades some
  concurrent throughput for correct labels, without holding a transaction across provider fetches.
- SQL validates the full evaluation JSON contract, including findings, catalog values, and
  agreement with indexed labels. Reads validate it again and omit malformed legacy labels so
  one bad record cannot crash the Leads page.
- Structured workplace/employment fields exist only for Ashby and Lever; Greenhouse and Workday
  rely on titles and location text.

## Verification

Unit tests: 70+ evaluator cases (hard rules, conservative keeps, graduation windows, flags, remote
and city labels, live-board regressions), collector structured fields, and service tests on the
in-memory repository (preference versions/receipts/audit/validation; collection filtering and
counts; refresh of excluded existing leads without review/version/availability changes; no effect
on availability; re-evaluation on preference and profile saves; stale re-evaluation refusal;
views, age limit, city sort, role filter). Database tests run the same flows against SQL,
including RLS, direct-write denial, owner mismatch, and evaluation payload validation.
Playwright covers preferences editing, the four views, the check summary, a stale form, and the
mobile form. A read-only live evaluation on 2026-09-27 (Ramp, Palantir, Datadog, Stripe,
Salesforce Workday, OpenAI, Anthropic) found no engineering title wrongly excluded after tuning.
