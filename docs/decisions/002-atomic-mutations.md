# 002 - Save mutations and activity in database transactions

Status: Accepted by the owner on 2026-09-20.

## Context

Updating an application and recording its history must succeed together. For example, a move to INTERVIEW must not leave the new status saved without its history entry if the activity write fails.

## Decision

Use narrowly scoped Postgres database functions called through Supabase RPC (remote procedure call: asking the database to run a named function). Each logical mutation saves all affected rows, its activity, and related timestamps in one transaction. A transaction commits all those writes or rolls them all back on failure.

Apply this to creation, status changes, detail edits spanning jobs and applications, note additions/edits, and each imported row. Store function definitions in repository migrations. The unified editable-notes model is defined in [decision 012](012-single-notes-section.md).

Both the website and local connector use this path:

Entry point -> shared application service -> repository -> database function -> primary change and activity committed together.

Application services continue to own command validation and business rules. Repositories invoke explicit functions rather than exposing arbitrary SQL. Database functions enforce ownership and persistence constraints, and record history from the state being changed in the transaction.

## Tradeoff

The project maintains some SQL alongside TypeScript. In return, database failure cannot leave a primary change committed without its activity. Separate API requests are not a substitute for a transaction.

## Verification

Test successful mutations and inject an activity-write failure to verify rollback of the primary change and related timestamps, including detail edits across tables.

## Scope of approval

This approves the transaction mechanism. Entire-import batch behavior was subsequently approved in [decision 007](007-atomic-import-batches.md), concurrent-edit handling in [decision 008](008-application-version-checks.md), retry behavior in [decision 009](009-mutation-retry-protection.md), and function-only web write permissions in [decision 010](010-function-only-web-writes.md). Existing credential decisions are unchanged. Ticket 1 is not yet authorized.
