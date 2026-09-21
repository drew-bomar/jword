# 006 - Warn about import duplicates and preserve user choice

Status: Accepted by the owner on 2026-09-20.

## Decision

Import preview flags likely duplicates against existing applications and other rows in the upload. The owner explicitly chooses to skip a flagged row or import it as a separate application. Never automatically merge, overwrite, or delete existing applications based on similarity.

Matching company/title, job URL, and external job ID are duplicate-warning signals. Job URLs and external IDs remain non-unique in the database so an explicit import-as-separate choice can succeed.

Importing a flagged row as separate creates a new job/application pair. Keep the existing one-application-per-job constraint; do not attach the new application to the existing job row. Company reuse is a separate, existing matching rule.

## Tradeoff

Some duplicate records may remain. The owner considers that preferable to combining or deleting distinct applications incorrectly, especially when companies reuse titles or posting URLs.

## Verification

Check that skipping a row leaves existing records unchanged, importing a flagged row creates a distinct pair, and identical URLs or external IDs do not block the explicit choice. Include duplicates within the same upload.

## Scope

This decision covers import duplicate handling and its database constraints. It does not add automatic merging, delete tools, or a generic override to MCP creation. Import batch transaction behavior was subsequently approved in [decision 007](007-atomic-import-batches.md).
