# 017 - In-page capture overlay and a narrow extension API

Status: Accepted by the owner on 2026-09-22. Replaces the side panel from
[decision 016](016-browser-extension-capture.md) and amends
[decision 005](005-web-server-actions.md) for this one adapter.

Follow-up: [decision 023](023-watch-capture-and-board-verification.md) adds three watch-capture
operations to this allowlist, using the same session and Origin boundary.

## Context

Decision 016 reviewed captures in Chrome's side panel, which framed jword's `/capture` page. The
owner found it still felt like a separate window and asked for a Jobright-style panel drawn inside
the job tab. jword cannot simply be framed into the job site: its session cookie is SameSite=Lax,
so it is a third-party cookie there and is not sent, and allowing any site to frame jword would
reopen clickjacking. The extension-drawn panel therefore needs its own way to reach jword.

## Decision

- **The overlay is an extension page drawn into the job tab.** On a toolbar click (`activeTab`),
  the background worker injects the extractor and a small host script. The host adds a closed
  shadow root holding an iframe of the extension's `overlay.html`, pinned right; on viewports at
  least 900 px wide it narrows the page (`html { width: calc(100% - 420px) }`) so the panel sits
  beside it. There is no floating launcher and no all-sites permission. Clicking again re-reads the
  page and replaces the review.
- **The overlay talks only to the background worker.** Every request carries a random nonce
  created for that capture and passed in the iframe URL fragment. The worker answers only messages
  from an `overlay.html` frame whose tab holds a capture with that nonce.
- **The worker calls a narrow JSON API with the owner's cookie.** Chrome attaches the normal jword
  session cookie to the worker's `fetch` when the extension has host permission for the jword
  origin (verified in a spike on 2026-09-22: Lax and Strict cookies both sent). There are exactly
  five POST Route Handlers under `/api/extension/`: `find-duplicates`, `search-applications`,
  `get-application`, `create-application`, and `update-posting`. Each calls one shared service.
- **Security at the API.** In order: `Origin` must equal `chrome-extension://<JWORD_EXTENSION_ID>`
  (the id is pinned by the manifest `key`; unset means the API is off); the body must be JSON under
  256 KB; then `requireSession` with the optional owner lock; then the shared Zod schemas, the
  version check, request-id retries, and atomic activity exactly as for Server Actions.
  `update-posting` first applies `capturePostingUpdateSchema`, which accepts only the posting fields
  and never a null. Responses are `private, no-store` and carry no CORS headers.
- **The review UI is shared.** `src/features/capture/capture-review.tsx` takes a `CaptureApi`
  instead of calling Server Actions. The extension bundles it with jword's UI kit and Tailwind
  theme and implements the API by messaging the worker. The retry attempt, stale refresh,
  `planCaptureUpdate`, and default status APPLIED are unchanged.
- **Removed:** the side panel, the `/capture` page, its `postMessage` handoff, and the panel-only
  sign-in view. `frame-ancestors 'self' chrome-extension:` is kept.

Runtime path: toolbar click → extractor (job tab) → overlay frame → `chrome.runtime` message →
background worker → `POST /api/extension/*` (Origin check → session → Zod) → shared service →
database function (record + activity + version + receipt in one transaction).

## Why the Origin check is the key control

The API trusts the owner's cookie, so it must also know the request came from the extension.
Otherwise another website could make the owner's browser send an authenticated request (cross-site
request forgery, CSRF). Browsers set `Origin` and web pages cannot change it. Chrome omits `Origin`
on the extension's GET requests, so every endpoint is POST, and a missing `Origin` is refused.
A non-browser client can forge `Origin`, but it would also need the owner's cookie. That cookie
already grants full access.

## Alternatives considered

- **Extension-held session token.** Unnecessary because the cookie is sent. It would also add a
  second credential surface to store and refresh.
- **Shadow DOM UI instead of an iframe.** Simpler styling, but the job page's scripts share that
  DOM and could read the owner's jword data shown in it. The cross-origin iframe prevents that.
- **Keep the side panel.** Rejected by the owner on feel.

## Tradeoffs

- decision 005 is amended: jword now has a small JSON API besides Server Actions. It stays limited
  to these five capture operations, is only for the extension origin, and contains no business
  rules.
- The overlay bundles React (about 350 KB minified, half of it React DOM). It loads from disk, not
  the network. Zod stays out of it: the background worker validates the captured posting (about
  90 KB), and `@jword/core` is marked side-effect-free and imports Zod as `import * as z` so
  bundlers can drop unused schemas and locales.
- Narrowing `html` does not move a site's fixed-position elements. Some headers can therefore run
  under the panel.
- `overlay.html` is a web-accessible resource with `use_dynamic_url`, so pages cannot probe for it
  by a fixed URL. A page that did frame it would get nothing without the nonce.

## Verification

Unit tests cover the Origin/content checks, the posting-only schema, and the worker's handling of
unreachable or unexpected responses (a lost save is `OUTCOME_UNKNOWN`). Playwright loads the real
extension to cover create, update through a stale version, sign-in recovery, and closing the panel.
It also checks that a stray overlay without the nonce is refused. A second spec calls the API
directly to check that jword's own origin, a foreign origin, and a missing Origin are refused. It
also checks the 401 JSON response for signed-out calls and that status is rejected. The spec
covers identical-retry replay and stale-version conflicts.
