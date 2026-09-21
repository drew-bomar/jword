# 001 - Web and local connector access

Status: Accepted by the owner on 2026-09-20.

## Context

The personal MVP should support phone and computer access without requiring a separate sign-in flow whenever the local Codex connector starts.

## Decision

- The hosted tracker uses Supabase email sign-in through a link or code. Browser sessions persist until expiry or sign-out; web requests use the authenticated user's session and database ownership protections.
- The local MCP connector uses a private Supabase service-role credential supplied through environment variables. It exposes only the bounded tools in the tooling specification and requires no separate email login.
- Configure the connector's owner through `JWORD_OWNER_USER_ID`. Shared services verify ownership, and repositories scope every operation to that owner.
- Both paths call the same application services and record mutations atomically with activity history.
- Keep the local credential out of Git, browser code, logs, and tool output. Do not use it for the hosted tracker's web requests.

## Runtime paths

- Drew: website -> email-authenticated web entry point -> shared service -> repository -> database.
- Codex: local connector -> shared service -> repository using the private local credential -> database.

## Tradeoff

The service-role credential bypasses Row Level Security (RLS), the database rules restricting access to an owner's rows. Owner checks and bounded tools constrain the connector's normal behavior, but a stolen credential could bypass those limits. The owner accepts that broader credential authority for simpler personal MVP setup.

A separate connector user-session login helper is deferred. Revisit a scoped credential or user-session flow if the connector becomes remotely accessible or the product expands beyond the personal workflow.

## Scope of approval

This record approves only the access setup. Subsequent choices and current readiness are recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md). Scaffolding is a separate next step.
