# 023 - Capture a company watch from the current board

Status: Accepted in the owner's Workday review follow-up, 2026-09-25.
Amends [017](017-extension-overlay-capture-api.md) and [022](022-workday-boards.md).

## Decision

The extension offers **Watch this company** when the current page or its captured job URL
identifies a supported board. Both Workday URL families use the shared parser, including the
account name used as the extension's company guess. The owner confirms the company or explicitly
selects an existing company. This creates a watch without creating an application. An existing
watch is managed in the watchlist; capture does not replace its boards or reactivate it.

Three operations join the extension's endpoint allowlist: `search-companies`, `verify-boards`,
and `add-watch`. They use the same extension Origin check, authenticated owner session, shared
schemas and services, RLS, atomic audit and request receipts as the existing paths. Browser
permissions are unchanged. Lost save responses keep the identical command/request ID; closing
or switching modes is disabled until the response is confirmed. Reloading or closing the tab
still discards the in-memory attempt, as with application capture.

`discoverCompanyBoards` accepts `mode: "verify"` to check only the supplied recognized board
URLs (one to three). It skips saved application reads and company-name/website probes, while
still checking company access and current board ownership. The extension verification endpoint
accepts only the narrower verification schema and forces this mode. The web picker uses it for
pasted boards and explicit upgrades; **Find boards** retains broader discovery. Public evidence
cache keys follow case-insensitive board identity; owner data is never cached.

Full discovery also recognizes direct board links in the company website field. It does not
fetch arbitrary careers pages. Old `OTHER` links offer an explicit **Use Workday board** (or
other recognized provider) action. Selecting that board replaces its equivalent legacy link in
place, including locale/posting aliases, rather than consuming another board slot.

Suggestions expose `verification: found | missing | error` separately from confidence: confidence
means evidence that the board belongs to the company, not proof its endpoint answered. Extension
capture requires explicit confirmation to save an unavailable/unverified board. SQL still checks
ownership at save time, so a board claimed after the lookup cannot be silently reassigned.

## Tradeoff

A toolbar click on a known board avoids pasting and broad network searches, but cannot discover
an unseen Workday site from a company name alone. Careers-page scanning, search-engine services,
additional ATS providers and job collection remain separate work. No new migration is required
beyond decision 022's two Workday migrations.
