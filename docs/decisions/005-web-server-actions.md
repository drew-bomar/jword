# 005 - Use Server Actions for web mutations

Status: Accepted by the owner on 2026-09-20. Amended by [decision 017](017-extension-overlay-capture-api.md):
five origin-restricted Route Handlers under `/api/extension/` serve the capture extension only.

## Context

The website needs to send form and button updates to server-side code. The local Codex connector already calls shared services directly, so it does not need a separate website API.

## Decision

Use Next.js Server Actions for web mutations. These still use an HTTP API: Next.js handles the POST request and dispatch to the selected server function instead of requiring a manually written mutation endpoint and browser request for each operation.

Each Server Action verifies the user's session and permission, validates boundary input using shared schemas, and invokes the shared application service. Do not rely solely on a page-level login check. Actions return safe, serializable results; they do not contain the authoritative business rules or raw database queries.

Use Server Components for server-rendered reads through shared services. Reserve Route Handlers for explicit HTTP needs such as authentication callbacks; do not build a parallel REST mutation API for the tracker.

## Runtime path

Button or form -> browser HTTP POST with submitted data and login cookie -> Next.js Server Action -> shared service -> repository -> database function -> result returned to the browser.

The browser never executes server-side database code. The local MCP connector continues to call the same shared services independently of the website.

## Tradeoff

The website's entry points depend on Next.js. The shared core remains independent and reusable by the connector and future integrations. This reduces hand-written network plumbing without removing the network request or the need for authorization.

## Scope of approval

This resolved the last of the five deliberate architecture choices. Subsequent product decisions and current readiness are recorded in the [Ticket 0 final review](../TICKET_0_REVIEW.md); scaffolding is a separate next step.
