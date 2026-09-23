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

## Browser extension capture

Build and load it first (`pnpm ext:build`, then Load unpacked `packages/extension/dist`; see
`packages/extension/README.md`). The jword server needs `JWORD_EXTENSION_ID` set (see
`.env.example`); restart it after adding the variable.

1. **New posting.** On a Greenhouse, Lever, or Ashby posting, click the jword button → a panel opens on the right of the page, the page moves over, and it
   shows company, role, location, and description filled in and "No matching applications found."
   → Add application → Open application: the detail page shows the fields, a collapsible Job
   description, and a "Created" activity.
2. **Match.** Capture the same posting again → it offers "Update … — …" and does not pre-select it;
   choose it → blank fields are ticked, fields that would replace a value are not → Update →
   "Details updated" in Activity; unticked values are unchanged. Set a field the application already has to blank or
   Unknown → the panel lists it as "keeping <saved value> (not in posting)" and the save leaves it.
3. **LinkedIn.** On a LinkedIn job, scroll to "About the job", then capture → company, role,
   location, and workplace are filled; the description is filled when it had loaded.
4. **Workday.** The company is flagged as guessed; correct it if needed before saving.
5. **Signed out.** Sign out, capture → the panel shows "Signed out of jword"; use "Sign in to
   jword" (opens a tab), sign in, then "Try again" in the panel → the posting is still filled in.
6. **Status.** New captures default to Applied, with date applied set to today.
7. **Close and re-capture.** The panel slides in from the right; the X slides it out and the page
   returns to full width (no animation when macOS "Reduce motion" is on). On LinkedIn,
   choose another job in the list and click the button again → the panel shows the new job.
8. **API is extension-only.** In a signed-in jword tab's console, run
   `fetch("/api/extension/find-duplicates",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)`
   → `403`.

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

## Reliability regression checks

- Open Edit details in two tabs. Save a role change in one and a location change in the other. On conflict, refresh: the location draft must remain. Review and reapply it; both changes must survive.
- Interrupt a save response after commit. Retry the original save; there must be only one application/note/import and one corresponding activity. Inputs stay locked until the result is confirmed.
- Browse beyond 200 applications and 50 notes/activity entries using More/First links. Changing a table filter returns to its first page.
- Direct RPC calls with an unknown field, non-HTTP URL, invalid date, oversized value, or wrong JSON type must fail without any rows or receipts being added. Automated checks cover this locally.
