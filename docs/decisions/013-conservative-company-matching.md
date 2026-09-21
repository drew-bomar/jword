# 013 - Match company names conservatively

Status: Accepted by the owner on 2026-09-21.

## Decision

Trim leading/trailing whitespace, collapse repeated whitespace, and ignore capitalization when comparing company names. Reuse the owner's existing company on an exact match after those steps.

Preserve punctuation and legal suffixes; do not infer aliases or abbreviations. IBM and ibm refer to the same company, while Acme and Acme Inc. stay separate unless the user explicitly selects the existing company. That selection links the application to the selected company; it does not rename or merge company records.

Keep unique `(user_id, normalized_name)` for companies. Match or create the company within the application mutation transaction. Use the same normalization contract in services and database functions, and check ownership of explicitly selected company IDs.

This policy concerns company identity only. Never combine applications based on a company-name match. Jobs and applications retain the duplicate-warning and explicit-choice behavior in decision 006.

## Tradeoff

Alternate spellings may produce separate company entries. The owner prefers that to incorrectly combining different employers or applications. No alias-management system or automatic company merge is needed for v1.

## Verification

Test capitalization and whitespace equivalence, preserved suffixes/punctuation, different-owner names, concurrent creation of an exact match, and explicit selection of an existing company. Confirm related applications remain separate.

## Scope

This resolves the last pending product decision. See [Ticket 0 final review](../TICKET_0_REVIEW.md) for current status and the next implementation step.
