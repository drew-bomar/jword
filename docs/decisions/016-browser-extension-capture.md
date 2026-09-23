# 016 - Capture job postings with a browser extension

Status: Accepted by the owner on 2026-09-22. Side panel and default status APPLIED adopted the same
day after the owner tried the first (popup window) version. **The side panel, `/capture` page, and
`postMessage` handoff are superseded by [decision 017](017-extension-overlay-capture-api.md)** (an
in-page overlay with a narrow extension API). Extraction, the update rules, and the APPLIED default
below still apply.

## Context

Entering a posting by hand (company, role, URL, location, description) is the slowest part of
tracking a new job. `V1_SCOPE.md` listed a "Chrome/browser autofill extension" as out of scope; the
owner explicitly requested this capture feature, which takes precedence over the scope list.
Autofilling application forms is still out of scope.

## Decision

A Chrome extension (`packages/extension`) reads the posting on the current tab and hands it to a
jword page, `/capture`, which previews it and saves through the existing Server Actions.

- **Extension = reader + launcher only.** When the owner clicks the toolbar button, `activeTab`
  lets the extension read that one page. Site adapters (LinkedIn, Greenhouse, Lever, Ashby,
  Workday) plus schema.org `JobPosting` JSON-LD and meta tags produce a plain posting object.
  Values guessed from a URL or meta tag are flagged for review.
- **Handoff stays in the browser, in Chrome's side panel.** The click opens the extension's side
  panel, which frames `{jword}/capture?embed=1` and answers the page's `ready` message with the
  posting via `postMessage`, only to the configured jword origin. The page accepts it only from its
  parent at a `chrome-extension://` origin. Every jword route sends
  `Content-Security-Policy: frame-ancestors 'self' chrome-extension:`, so only jword and extension
  pages can frame it (this also blocks clickjacking by other sites).
- **Sign-in happens in a normal tab.** Chrome sends jword's existing session cookie inside the
  panel frame but does not keep cookies set there, so a signed-out panel shows "Sign in in a new
  tab" and an "I've signed in" button that resumes the capture.
- **jword owns all decisions and writes.** The page validates the payload with a shared schema
  (`packages/core/src/capture`), shows duplicate candidates from the existing duplicate probe and a
  search box, and saves with `createApplicationAction` or `updateDetailsAction`. There is no new
  mutation service, database function, API route, or credential.
- **Updates are explicit and field-by-field.** A capture may only change posting fields: job URL,
  external ID, location, work arrangement, date posted, source, and description. Fields that are
  blank on the record are pre-selected; fields that would replace a value are not. Status,
  priority, owner dates, company, and title are never changed by a capture. A capture never clears
  a field.
- **New captures default to status APPLIED** (captures usually happen while applying, so date
  applied defaults to today); the owner can choose another status before saving.
- **Matches are offered, never chosen.** With candidates present, the owner must pick one to update
  or explicitly choose "New application" (which then creates with `allowDuplicate`).

Runtime path: toolbar click → extractor (job tab) → side panel framing `/capture` → `postMessage` →
preview (Zod-validated) → Server Action → shared service → database function (record + activity +
version + receipt in one transaction).

## Alternatives considered

- **Extension popup UI + JSON Route Handlers** (`/api/extension/*`). Keeps the preview inside the
  job tab, but adds a parallel HTTP mutation API (contradicting decision 005), needs CSRF/origin
  hardening, and duplicates the form, retry, and conflict logic in the extension. Server Actions
  cannot be called from an extension origin: Next.js rejects a mismatched `Origin`.
- **Extension-held Supabase session/token.** A second credential surface to store and refresh.

## Tradeoffs

- The preview is a jword page framed in the side panel, so signing in must happen in a normal
  tab. The side panel was chosen over the first version's separate popup window, which felt
  detached from the job page.
- Extraction depends on third-party markup. LinkedIn in particular uses hashed class names, so its
  adapter reads the page title, top-card text lines, and `componentkey` attributes; it still breaks
  when LinkedIn changes. Every value is editable in the preview, and `packages/extension/SITES.md`
  tracks what is supported.
- Actor type stays `USER`: the owner reviewed and confirmed the save. The activity summary does not
  record that the values came from a capture.

## Verification

Unit tests cover payload normalization, the update planner, and each site adapter against small
fixtures that mirror the real markup (checked against live Greenhouse, Lever, Ashby, Workday, and
LinkedIn pages on 2026-09-22). Playwright covers create, explicit update with a stale-version
conflict, the no-extension state, and one run that loads the real built extension into Chromium.
