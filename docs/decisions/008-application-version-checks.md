# 008 - Reject edits based on an outdated application version

Status: Accepted by the owner on 2026-09-20.

## Decision

Each application has a positive integer `version`, initially 1. Reads return it, and mutations of an existing application require `expectedVersion`. The database function checks ownership, locks the application row, and compares versions inside the same transaction as the mutation. A version mismatch returns `CONFLICT` with reason `STALE_VERSION` without changing the application or its history.

Every meaningful status or detail change, including related job fields, and every added or edited application note increments the application version once with its activity. A valid no-op does not increment it. Successful mutation results include the resulting version. The unified editable-notes model is defined in [decision 012](012-single-notes-section.md).

The web UI displays: "This application changed since you opened it. Refresh before saving." Preserve the user's unsaved input separately while fetching the latest record; allow review and reapplication rather than silently overwriting newer data.

Codex re-reads and reassesses on a stale-version conflict. It must not blindly replace the version and replay the old command. Ask for clarification if newer information makes the intended change unclear.

## Why the check happens during the save

A caller-side check alone leaves a gap: another edit can occur between checking freshness and saving. Comparing versions inside the database transaction closes that gap.

Runtime path: loaded version -> submitted expected version -> shared service -> repository -> database comparison and atomic save -> confirmed result or refresh warning.

## Tradeoff

This is a whole-application check. Even edits to different fields can conflict, requiring a refresh and review. It avoids silent overwrites without implementing automatic field merging.

## Verification

Submit two mutations based on the same version and verify only one succeeds. Verify that the other creates no activity or partial edits, valid no-ops do not increment the version, and the website preserves unsaved input during refresh. Cover conflicts involving related job-field edits and application-note additions/edits.

## Scope

This resolves concurrent-edit handling. Replay protection after a lost response was subsequently approved in [decision 009](009-mutation-retry-protection.md): check a committed receipt before the version check so retrying an already successful command returns its prior result. Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
