# Manual verification

Run these after `pnpm db:start`, `.env.local` setup, `pnpm owner:create`, and `pnpm dev`.
Local emails land in Mailpit at http://127.0.0.1:54324.

## Web

1. **Sign in.** Open `/sign-in`, enter the owner email, submit. Open Mailpit, copy the 6-digit code,
   enter it. You land on `/` with an empty-state card. Signing in with an unknown email shows an error
   and creates no account.
2. **Create.** Add application → company "Datadog", role "Backend Software Engineer", status Applied,
   leave "Date applied" blank, add an initial note → the detail page shows today's date (Central time)
   under Date applied, the note in Notes, and a "Created" activity.
3. **Inline status.** From the detail header (or a table row), change status to Interview → toast,
   badge shows Interview, "Status changed" appears first in Activity with Applied → Interview.
4. **Notes.** Add a note → it appears with its added timestamp and Activity shows "Note added". Edit
   the note text → "edited <timestamp>" and "Note updated" in Activity.
5. **Edit details.** Edit details → change Location and Priority → save → details update and
   "Details updated" lists both fields with before/after.
6. **Stale edit.** Open the same application in two tabs. Change status in tab A. In tab B change
   status → the toast says the application changed since you opened it and the page refreshes with
   tab A's value. Edit details in tab B → the form keeps your input and shows the refresh warning.
7. **Duplicate.** Add application with the same company and role → "Possible duplicate" alert with a
   link; nothing created. "Create anyway as a separate application" creates a second record.
8. **Table.** Search "data" (row stays), search "zzz" (no-results state with Clear filters), filter by
   status, sort by company, click a stage chip to filter by that status.
9. **Import.** `/import` → choose `public/jword-import-template.csv` → mapping auto-fills Company and
   Role → Validate rows → the Datadog row is flagged as a likely duplicate and unchecked; IBM is
   valid → tick "Import as a separate application" on Datadog or leave it skipped → Import → summary
   shows the count; `/` lists the new rows with "CSV import" activities.
10. **Profile.** `/settings/profile` → fill a name and LinkedIn URL → Save → reload; values persist.
    An invalid URL shows an inline error.
11. **Mobile.** Narrow the window below 768px: rows become cards; status and priority are still
    editable; all forms remain usable.
12. **Forbidden.** Set `JWORD_OWNER_USER_ID` to a different user's id and restart: the app sends the
    signed-in user to `/forbidden` with a sign-out button.

## MCP (Codex or Claude Code)

Follow `docs/MCP_SETUP.md` to register the server, then in the agent:

1. "What's in my pipeline?" → the agent calls `get_pipeline_summary` and reports counts.
2. "Move the Datadog backend role to final round." → `search_applications` returns one match →
   `update_application_status` → the web timeline shows a "Status changed" entry by "Coding agent".
3. Create a second IBM application in the web UI, then say "Mark IBM as rejected." → the agent lists
   both IBM applications and asks which one; no mutation happens until you answer (check Activity).
4. "Add a note to Datadog: sent thank-you email." → `add_application_note` → note visible in the web
   Notes section.
5. Say "Move Datadog to final round" again → the agent reports a no-op (status unchanged).
