# 021 - Confirmed watch deletion with retained audit history

Status: Accepted by the owner's explicit request on 2026-09-24 to remove companies from the
watchlist altogether. Amends decision 018's deactivation-only contract and the v1 destructive
operation exclusion only for watch configuration.

## Behavior

Delete removes a watch and its board selections from both active and inactive lists. It preserves
the company, its interest/website/notes, all applications, and watch audit history. Adding the
company again creates a new watch ID and requires choosing boards again. Companies with existing
applications can appear in Suggest from applications again; deletion is not a permanent exclusion.
Deactivate continues to pause a watch and preserve its configuration for reactivation.

The browser confirms the company by name, focuses Cancel initially, and disables dismissal while
deletion is pending or unconfirmed. The confirmation captures the displayed watch version. Stale
versions require reviewing current details and confirming again; lost responses retry the exact
original request. The MCP tool requires reading one explicit watch and user confirmation before
passing `confirmed: true`.

## Runtime and storage

DeleteWatchDialog → deleteWatchAction (authenticated session) → deleteWatchedCompany (shared Zod
schema) → repository → public.delete_company_watch. MCP's delete_watched_company uses the same
service. The SQL wrapper independently validates confirmation, fields, ownership, and version.
The private transaction locks company before watch, records WATCH_DELETED, deletes the watch
(cascading its boards), and saves a retry receipt. A failed audit write rolls everything back.
Replay is checked before looking for the removed watch; an old deletion retry cannot delete a
replacement watch.

Audit rows now have an `original_watch_id` historical identity and a nullable `watch_id` reference
to a live watch. A before-insert trigger copies the live ID; the existing composite foreign key
checks ownership. Deletion clears only `watch_id` via `ON DELETE SET NULL (watch_id)`, preserving
the historical ID and `user_id`. Existing audit payloads remain unchanged. New deletion metadata
includes company ID and the boards removed, without copying company notes. Owner-only RLS remains.

## Tradeoff

Hard deletion releases board and company uniqueness claims and keeps normal reads simple. Audit
history has a historical identity even when its live record no longer exists; there is no restore
operation or new audit browser. Retained history remains accessible through owner-scoped database
reads. Before adding collected postings, their source retention must be designed explicitly.

## Verification

Unit/MCP tests cover confirmation, ownership, versions, audit attribution, and replay after re-add.
Database tests cover active/inactive deletion, preserved applications/notes/history, board release,
direct RPC validation, RLS, stale versions, request reuse, and rollback on audit failure.
Browser tests cover cancel, confirmation, re-add, preserved application notes, and lost-response
retry on desktop and mobile. See HANDOFF.md for executed checks and environment limitations.
