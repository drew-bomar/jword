# 012 - One Notes section with optional editable dates

Status: Accepted by the owner on 2026-09-21.

## Decision

Provide one Notes section per application, containing individual text entries. Each note has an optional date label controlled by an Add date button. Notes default to undated; choosing today uses America/Chicago, and the owner may choose another calendar date. Text and date remain editable after saving; removing a date leaves an undated note.

Replace the proposed editable application summary and timeline-note input with this single flow. Keep current notes in `application_notes`, with stable IDs, ownership, an application reference, body, optional `note_date`, and actual creation/update timestamps. The user-selected date is not the creation timestamp.

Add and edit operations use the shared services and database functions. They create NOTE_ADDED/NOTE_UPDATED activity, increment the application's version, update its activity timestamp, and save a retry receipt atomically. Preserve drafts on conflicts; no-op edits do not create activity or increment versions. Verify ownership and the note/application relationship in the database.

The activity timeline automatically describes note changes; users never enter the same note in two places. Retain changed text/date before-and-after values in owner-protected edit history, while excluding note text from logs, mutation responses, and retry receipts. Current notes are displayed in the Notes section rather than reconstructed from activity.

Creation may include an optional initial undated note. A nonblank CSV notes cell likewise creates one undated note, preserving line breaks. Those initial notes are part of the CREATED/IMPORTED transaction and referenced by its activity; they do not create a separate user action or additional version increment.

Add a bounded `update_application_note` tool alongside `add_application_note`, using stable application and note IDs, expected application version, and request ID. Remove summary-note editing from generic application-detail commands. Note deletion remains outside v1.

## Tradeoff

One clear notes interface replaces two competing places to write. Editable individual notes need a small dedicated table and update operation, while the activity log preserves changes independently.

## Verification

Cover undated creation, date selection/removal, text edits, no-op edits, wrong-owner/wrong-application note IDs, stale versions, retries, atomic rollback, and initial notes from creation/import. Verify the Notes section displays the updated note once and date labels do not alter creation timestamps.

## Scope

This supersedes the previous summary-versus-timeline-note model. Company matching was subsequently resolved in [decision 013](013-conservative-company-matching.md). Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
