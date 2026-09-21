# 004 - Use hosted Supabase during MVP development

Status: Accepted by the owner on 2026-09-20.

## Context

The owner considers a separate local database unnecessary for this personal MVP and is comfortable testing against real tracker data, with source records retained in their notes app.

## Decision

Use one hosted Supabase project for development and real tracker use. The web application still runs locally during development and connects to that hosted project. Skip local Supabase, Docker, and a separate development database.

Keep database changes in checked-in migrations: saved instructions defining how the database changes. Apply the initial migrations to the empty project before importing real data, then apply subsequent changes incrementally.

Keep unit tests independent of the database. Run targeted database checks for ownership and atomic mutations against the hosted project, using identifiable test records or transaction rollback where appropriate. Do not automatically seed or reset the real tracker. The existing rule against unrequested destructive operations remains in force.

## Tradeoff

This reduces setup and local resource use, but database-backed work needs an internet connection and development mistakes can affect real records. The owner accepts that tradeoff for the MVP. The notes-app records are a recovery source, not a verified database backup or an automated restore process.

Clean-database migration verification happens initially, before real data is imported. Do not claim repeated clean-database verification unless it was actually performed in a suitable empty environment.

Revisit a separate test database when public use, larger data volume, or frequent destructive migration tests make isolation useful.

## Scope of approval

This changes the development environment, not the hosted web sign-in, shared-core structure, or transaction guarantees. Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
