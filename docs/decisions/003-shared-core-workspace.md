# 003 - Website and connector share a core package

Status: Accepted by the owner on 2026-09-20.

## Context

The website and local Codex connector need the same validation and application operations. The structure must also support later model integrations without depending on Codex as the permanent interface.

## Decision

Use one pnpm workspace, meaning related packages managed together in one repository, with one lockfile and root commands:

- Root Next.js application: screens, forms, browser sessions, and web entry points.
- `packages/core`: domain types, validation, application services, repository contracts, and the Supabase repository implementation.
- `packages/mcp-server`: bounded tool handlers, stdio transport, and local credential setup. Implement this at Ticket 7 after the tracker is stable.

Both entry points import the shared core. The core imports neither entry point and receives database clients and actor context from them. Keep browser-safe schemas separate from runtime exports. Build the shared package so the connector can execute in Node without importing Next.js application source or requiring a running web server.

Do not add a package for every layer or additional monorepo orchestration tooling.

## Runtime paths and future extension

- Website -> shared service -> repository -> database.
- Local Codex connector -> shared service -> repository -> database.
- Future in-app chat -> model adapter -> shared service -> repository -> database.

An adapter translates an interface's input into the shared application's commands. Model adapters would interpret language; the core and database would continue enforcing permissions, validation, and persistence rules. MCP could remain optional or be removed without rewriting the core.

## Tradeoff

There is a small initial package/build setup cost. In return, both current interfaces reuse the same rules and later interfaces can do so too.

This structure does not by itself make the personal MVP ready for public use. Multi-user access, credential restrictions, and limits on model usage and cost would need separate decisions before that launch.

## Scope of approval

Provider/model integrations and their abstractions remain out of v1. This decision approves code organization and pnpm, not those future features. Current readiness is recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
