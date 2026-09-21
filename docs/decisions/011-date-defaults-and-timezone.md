# 011 - Use Central time for interactive date defaults

Status: Accepted by the owner on 2026-09-21.

## Decision

Use `America/Chicago` as the owner timezone for calendar dates and relative-date interpretation. This follows Central time through daylight saving changes. Configure web and MCP consistently through `JWORD_TIMEZONE`; do not infer today's date from the database host, browser location, or a fixed UTC offset.

- New interactive applications default an omitted date found to today.
- Entering APPLIED, including interactive creation in that status, defaults a missing applied date to today unless an explicit date or null was supplied.
- Preserve existing dates unless explicitly edited. Returning to an earlier status does not erase them.
- An explicit date overrides the default; explicit null keeps the date blank. Dates remain editable.
- Imports preserve missing dates as null regardless of imported status. No unconditional database date default is appropriate.

The shared services own these rules for web and direct Codex commands. Database date columns remain calendar dates, separate from timestamped activity. Tool descriptions explain defaults and confirmations state resolved dates when the request uses words such as today or yesterday.

If a status command repeats the existing status and makes no effective date change, it is a no-op; it does not fill an unknown date by itself. A date-only change records DETAILS_UPDATED, while a status change and accompanying date update commit together. Retry fingerprints continue to represent the original caller intent before defaults, as required by decision 009.

## Tradeoff

Defaults reduce manual entry for current activity without inventing dates for historical imports. When recording an older event interactively, the owner or Codex must supply the actual date.

## Verification

Test Central-time midnight and daylight saving boundaries, browser/server timezone differences, explicit dates and nulls, existing-date preservation, imported APPLIED records with unknown dates, and no-op/date-only updates.

## Scope

This resolves date defaults and timezone. Notes were subsequently resolved in [decision 012](012-single-notes-section.md), and company matching in [decision 013](013-conservative-company-matching.md). Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
