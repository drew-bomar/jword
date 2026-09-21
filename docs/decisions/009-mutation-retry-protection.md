# 009 - Make retries safe with request IDs

Status: Accepted by the owner on 2026-09-20.

## Decision

Every application save and import commit carries a caller-generated request UUID. The caller retains that ID and the original command when retrying after an unconfirmed result. This provides idempotency: repeating a request does not repeat its effects.

Store a minimal internal receipt in `mutation_requests`, keyed by `(user_id, request_id)`, containing the operation, a fingerprint of the validated caller intent, and its safe successful result. Include expected version and explicit duplicate choices in the fingerprint, before resolving time-dependent defaults. Do not store raw commands, notes, or uploaded CSV contents in receipts.

After authorization, the database transaction serializes competing requests with the same key. A matching committed receipt returns the saved result without another write. A different command or operation with the same key returns `CONFLICT`/`REQUEST_ID_REUSED`. Otherwise, run normal validation, duplicate checks, and version checks, then commit the primary changes, activities, and receipt together. A rollback leaves none of those writes. A successful no-op records a receipt but no new activity or version increment.

Receipt lookup precedes stale-version rejection and duplicate detection: a retry must recognize its own earlier success. The result describes that earlier commit, not necessarily the application's current state. Return a replay indicator; fetch fresh state if needed.

For imports, one request ID and receipt cover the entire selected batch. Deliberately importing another copy is a new operation with a new request ID and the normal duplicate warning/choice flow. Changing a command after reviewing a stale-version conflict also creates a new operation.

Keep receipts owner-scoped, protected by RLS, and internal to database functions. Retain them for v1 without an expiry worker.

## Tradeoff

This adds a small internal table and request-ID plumbing. It prevents retries after connection failures from creating extra applications, notes, history entries, or imports. It does not identify similar records; deliberate duplicates remain supported.

## Verification

Test lost-response retries, concurrent submissions with the same ID, changed input under the same ID, cross-owner receipt isolation, failed-write rollback, and successful no-op replays. Verify that retries do not rerun time-dependent defaults or fail solely because the original success incremented the version.

## Scope

This completes retry handling left open by decisions 002, 007, and 008. Function-only web write permissions were subsequently approved in [decision 010](010-function-only-web-writes.md). Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
