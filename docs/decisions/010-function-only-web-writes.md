# 010 - Require approved database functions for web writes

Status: Accepted by the owner on 2026-09-20.

## Decision

Normal authenticated web callers may read their own tracker records and execute approved mutation functions. They may not directly insert, update, or delete table rows. Keep retry receipts internal to mutation functions and prevent direct activity-history writes.

Runtime path: website -> authenticated Server Action -> shared service -> repository -> approved database function -> primary change, history, version, and retry receipt committed together.

Grant function execution explicitly and revoke default public/anonymous execution. Privileged implementations belong in a private schema behind narrow exposed wrappers, with fixed search paths, schema-qualified references, strict inputs, and explicit ownership checks. Derive the web owner from the verified session rather than accepting an unchecked owner ID. Do not assume RLS automatically limits a privileged function's writes.

The local connector uses the same functions in normal operation. Its service-role credential still has broader authority, as accepted in decision 001; these web permission restrictions do not reduce that credential's underlying power.

## Tradeoff

This adds database permission configuration, without additional login steps. It makes it harder for future application code to accidentally save a change without its history, version check, or retry receipt.

## Verification

Verify owner reads and permitted function calls, denial of direct authenticated table writes, denial of anonymous function calls, cross-owner rejection, and preservation of atomicity/version/retry guarantees. Test the privileged connector path separately with its configured owner.

## Scope

This resolves the web write-boundary finding. Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
