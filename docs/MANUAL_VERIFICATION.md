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

## Workday boards (decision 022)

Needs migrations `20260924000200` and `20260924000300` on the database the app uses. Board
checks call the real Workday endpoint from your dev server.

1. **Paste a posting link.** Add company → "NVIDIA" → paste
   `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/…` (any NVIDIA
   posting) → Add → a Workday `nvidia/wd5/NVIDIAExternalCareerSite` row appears, ticked, with
   "2000+ open jobs", sample titles, and "Checked from your link". No Workday board appears
   before you paste (it is never guessed).
2. **Other URL family.** Paste `https://wd5.myworkdaysite.com/en-US/recruiting/nvidia/NVIDIAExternalCareerSite`
   → it becomes the same board ("already selected" if the first is still selected).
3. **Missing board.** Paste `https://nvidia.wd5.myworkdayjobs.com/NoSuchSite` → the row says
   "Unlikely match" and "The board no longer exists". Untick it before saving.
4. **Save.** Add to watchlist → the row lists "Workday nvidia/wd5/NVIDIAExternalCareerSite" and
   "Started watching NVIDIA (Workday …)". Adding the same board to another company is refused.
5. **From applications.** A company whose saved application links to a Workday posting shows
   that board as a Strong match when you add it, and under Suggest from applications.
6. **Agent.** Ask Claude Code/Codex to watch a company and give it a Workday link → it calls
   `discover_company_boards` with `boardUrls`, then adds the board after confirming.

## Company watchlist (decisions 018, 019)

Board lookups call the real Greenhouse, Lever, and Ashby APIs from your dev server.

1. **Open.** Click Watchlist in the header → the empty state offers Add company and Suggest from
   applications.
2. **Add by name.** Add company → type "Stripe" and pause → within a few seconds "Found N boards"
   lists Greenhouse `stripe` as a Strong match with its open-job count and sample titles, ticked.
   Add to watchlist → the row lists the board(s), Active, and "Started watching Stripe (…)".
3. **Weak matches.** Add a company whose name is common (for example "Notion"). Strong matches are
   ticked; Possible/Unlikely ones are shown but unticked with the reason (for example a different
   board name). Tick only what is right.
4. **Nothing found.** Add a company with no Greenhouse, Lever, or Ashby board → "No public
   Greenhouse, Lever, or Ashby board found" with the names tried and "Workday boards are not
   guessed". Paste a non-board careers URL under Add a board by URL → it is kept as a careers page
   and nothing is fetched. Saving with no board also works.
5. **Three at most.** With three boards selected, adding a fourth by URL says "at most 3" and the
   remaining checkboxes are disabled.
6. **Suggest from applications.** Click Suggest from applications → companies you applied to via
   Greenhouse/Lever/Ashby links are listed with their boards → Watch N companies → they appear in
   the table.
7. **Edit.** Edit a company → remove a board, click Find boards, tick another, change interest →
   Save → the row updates and says "Updated watch for …".
8. **Stale edit.** Open /watchlist in two tabs. In tab B open Edit and type a website. In tab A
   click Deactivate. Save in tab B → "This watch changed since you opened it"; the draft stays.
   Refresh latest values → Reapply my edits → Save.
9. **Deactivate/reactivate/duplicate.** Deactivate shows Inactive (icon + word); applications are
   unchanged. Adding the same company again shows its boards as "Already watched for …" and
   saving offers Reactivate it; no second row appears.
10. **Phone width.** Rows become cards; the add dialog and header fit without sideways scrolling.
11. **MCP.** Rebuild (`pnpm mcp:build`), restart the agent, and say "Watch Figma" → the agent calls
    `discover_company_boards`, adds high-confidence boards with `add_watched_company`, and asks
    about weaker ones. The web row shows "· Coding agent".

## Watchlist review regression checks (decision 020)

Use the latest migration (`pnpm exec supabase migration up --local` for the test stack;
`pnpm exec supabase db push` when ready to apply it to the hosted tracker).

1. Add company → type Stripe → wait for selected boards → change to Ramp. Stripe's boards must
   disappear immediately, and only Ramp's boards should be saved. Repeat while lookup is running.
   For a company already in the tracker, untick a suggestion before choosing its existing-company
   search result; the suggestion must stay unticked after the next lookup.
2. Start a board lookup, then save without waiting. Save should complete independently. An aborted
   lookup must not populate another company or an already-closed form.
3. Deactivate a watch, add that company again, and choose Reactivate it. Interrupt its response
   after the request reaches the server. Only Retry reactivation should be usable; Add and Cancel
   remain disabled until retry confirms the result. There should be only one activation event.
4. Temporarily go offline for Find boards or Suggest from applications. Both should show a useful
   error and permit retry after reconnection. Partial provider errors must not claim a complete
   search; unknown ownership must prevent automatic board selection.
5. Edit and save an application, then reopen Edit details without reloading the page.
6. Set `JWORD_BOARD_DIRECTORY=fixtures` without local test configuration and start the app. Startup
   must reject it. Clear the variable afterward for real provider lookups.

## Delete a watch (decision 021)

Apply `20260924000100_delete_company_watch.sql` to the environment being tested first.

1. On Watchlist, choose Delete beside a test company. The dialog must name that company and
   explain that applications, company notes, and history are kept. Choose Cancel; the watch stays.
2. Open Delete again and choose Delete from watchlist. The company disappears, including after
   refresh and when showing inactive watches. If it had applications, confirm those still open.
3. Add the same company again. It should create a new watch without an Already watched warning.
   Select its boards again. Repeat deletion with an inactive watch and on a narrow/mobile viewport.

Automated tests cover lost-response retry, stale versions, ownership, and audit-write rollback.
There is no need to interrupt a real deletion manually.

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

## Workday review fixes and extension watch capture (decision 023)

1. Run `pnpm ext:build`, reload jword in `chrome://extensions`, and refresh the board tab.
   Start the updated jword server and sign in normally. The two Workday migrations from
   decision 022 must already be applied to the database this server uses.
2. Open a Workday board or posting, click the jword toolbar icon, then **Watch this company**.
   Confirm/correct the company, choose an existing company if appropriate, and **Add to
   watchlist**. Check that the watch has one Workday board and no application was created.
   Repeat with a `wd5.myworkdaysite.com/recruiting/account/site` URL: the company guess should
   be the account, never “Wd5”.
3. Reopen capture for that company. It should show that the company or board is already watched
   and link to the watchlist, without replacing existing boards or reactivating the watch.
4. In Add company, enter a company name and put its direct Workday board link into Website.
   Discovery should offer that board without pasting it into the board picker.
5. If you have a pre-Workday watch whose board is saved as Other, edit it and select **Use
   Workday board** beside the selected link. The selected count should stay the same; save and
   reopen to check the provider. This also works when three boards are already selected.
6. Paste a known board in the picker. Its check should report only that board. Use **Find
   boards/Search again** when you want a broader company search. The browser's network panel
   should show `mode=verify` on the pasted-board lookup.
7. For a missing/unreachable board, extension capture must label the uncertainty and require
   the unverified-save checkbox. If a save response is lost, **Retry watch save** must retain
   the command; close and mode-switch buttons stay disabled until confirmed.

Automated browser tests cover the extension save/retry path and endpoint access checks, but
could not run in the review sandbox because binding the Playwright server to port 3100 was
refused (`EPERM`). Real Workday availability and the Chrome toolbar flow need manual verification.
