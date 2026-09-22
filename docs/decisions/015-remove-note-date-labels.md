# 015 - Remove note date labels

Status: Accepted by the owner on 2026-09-21, after using the imported tracker.

## Decision

Notes no longer carry an optional user-chosen date label. Each note keeps its real `created_at` and
`updated_at`, and every change is already timestamped in the activity timeline, so the extra editable
date was redundant. `application_notes.note_date` is dropped; `add_application_note` accepts only
`note`, and `update_application_note` requires replacement `note` text. Both reject unknown keys.

This supersedes the date-label parts of [decision 012](012-single-notes-section.md). The single
Notes section with individually editable notes stays.

## Tradeoff

Backdating a note (for example, recording an interview that happened last week) now means saying
so in the note text. The owner prefers one fewer control over that precision.

## Migration

`supabase/migrations/20260921000400_remove_note_dates.sql`. Existing labels are discarded; note
bodies and timestamps are untouched.
