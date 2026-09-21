# 007 - Import selected rows all-or-nothing

Status: Accepted by the owner on 2026-09-20.

## Decision

After preview and confirmation, save all selected valid rows in one database transaction. If any selected row or its activity fails, roll back every write in the batch. This includes newly created companies, jobs, applications, initial notes, retry receipt, and activity records. Existing applications are not overwritten or merged.

Rows with preview errors must be corrected or excluded before confirmation. Skipped rows are outside the transaction. Explicit import-as-separate choices follow decision 006.

Runtime path: confirmed selection -> import service -> repository -> one narrow batch database function -> commit all selected rows and history, or roll back all batch writes.

Revalidate inputs and duplicate choices at commit. A stale preview cannot authorize silent changes in behavior. Keep imports bounded so they can complete synchronously; choose and test byte/row limits in Ticket 6. Do not implement independent row commits or silent partial success.

## Tradeoff

One failing row prevents the selected batch from being saved, so the owner must fix the problem and retry. This avoids having to identify which rows were committed after a partial import.

A database failure rolls the batch back. A lost network response is different: the transaction may already have committed. Report that outcome as unconfirmed. Safe retries of the identical batch using its original request ID were subsequently approved in [decision 009](009-mutation-retry-protection.md).

## Verification

Test successful batches, skipped/error rows, deliberate duplicates, and an injected failure late in a batch. After failure, verify that none of the batch's primary or activity writes persist and pre-existing applications are unchanged.

## Scope

This extends decision 002 from per-record atomicity to the entire selected import batch. It does not add a bulk MCP tool or background worker. Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
