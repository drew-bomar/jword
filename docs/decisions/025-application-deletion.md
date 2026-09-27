# 025 - Confirmed application deletion

Status: Accepted by the owner on 2026-09-25 ("there is currently no way to fully delete an
application, which is annoying for testing"; chose full removal and returning linked leads to
New). Amends the v1 destructive-operation exclusion for applications, as decision 021 did for
watches. Web only: no MCP tool deletes applications.

## Behavior

Edit details has a **Delete application** section. A second step names the application and
company and requires **Delete permanently**; Cancel returns to the first step. Deletion removes the
application, its `jobs` row, its notes, and its activity history. The company stays (watches,
leads, and other applications may use it). A lead that became this application returns to New
(version bumped, `LEAD_RESTORED` audit row) so it can be created again. The browser returns to the
applications list.

## Runtime and storage

DeleteApplication (inside EditDetailsDialog) → `deleteApplicationAction` (session) →
`deleteApplication` (shared Zod schema: `confirmed: true`) → repository →
`public.delete_application` (validates the command, requires `confirmed`, resolves the owner) →
`jword.delete_application`: retry receipt check first, `lock_application` (ownership and
expected version), restore linked leads, delete the application (notes and activities cascade),
delete its job row, save the receipt. One transaction. A lost response retried with the same
request id returns the original result instead of NOT_FOUND. Migration
`20260925000200_delete_application.sql`.

## Tradeoff

Unlike watch deletion (021), no audit history of the application remains: the owner chose a
clean removal for testing. The retry receipt in `mutation_requests` still records that a
deletion happened (operation, request id, summary). There is no undo.

## Verification

Unit tests (in-memory repository) and database tests cover confirmation, stale versions, owner
isolation, cascade of job/notes/history, the company kept, replay after deletion, the linked lead
returning to New and being promotable again, direct-RPC validation, and denial of direct table
writes. Playwright covers cancel and delete from Edit details on desktop and mobile.
