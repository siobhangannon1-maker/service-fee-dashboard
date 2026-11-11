# Manual icon eligibility correction

Local only. Base commit 14ee0bb72e471fbb73c59b5bea09e9e459ecac51; production deployment dpl_8oCTEumtoBqR6CYXhNoA12f3zdoV. Worktree /Users/siobhangannon/docudental-manual-icon-eligibility-fix, branch fix/manual-icon-eligibility-performance. No production writes, completion, retry, migration or deployment performed during this investigation.

## Confirmed failure and evidence

The browser reports HTTP 503 after 6.45 seconds, before the confirmation dialog. Vercel request metadata confirms eligibility GET 503s. The deployed route wraps inspect_manual_letter_icon in a five-second AbortSignal and converts RPC/contract failures into generic 503. A legitimate negative eligibility result instead returns HTTP 200 with eligible=false. The UI discards server error classifications, producing its generic Refresh message.

The RPC delegates to workflow_resolution_snapshot. Its locking and evidence queries repeatedly evaluate workflow_resolution_job_associated(to_jsonb(helper),draft) over the complete Praktika job table. Production EXPLAIN shows a sequential scan over approximately 106,000 helpers. A deliberately bounded read-only measurement of one such scan was cancelled at 2.5 seconds. The snapshot repeats that work and calls a legacy-safety query with the same predicate, explaining exhaustion of the five-second RPC budget. No live inspect/confirm RPC was invoked by this investigation.

A read-only relational candidate query on the same database returned the same three related helpers in about 90 ms. It did not remove an association check: the original function still evaluated every selected candidate. This was not the earlier large audit-journal download: affected failed-icon candidates had only 20–24 audit records each. Functions/signatures/service-role execution permissions are installed correctly; the endpoint uses the existing server-only admin client after active-account and role authentication.

A sampled recent icon-only failure has a second issue: its completed PDF helper retains lock timestamps/owner. The existing workflow_resolution_legacy_execution_safe check accepts that exact terminal result; Stage 2's earlier raw lock-field check rejects it anyway. Other sampled clinical/parent/appointment/MediRef bindings passed. This is a sampled record, not an assertion that every user-reported letter has identical evidence.

## Minimal proposed changes

1. New service-role-only workflow_resolution_associated_jobs(uuid): materialise cheap candidate IDs, fetch only their full rows, then apply the unchanged workflow_resolution_job_associated predicate. Candidate discovery covers direct/case-insensitive draft bindings, parent links, file paths, canonical unscoped icons and receipt-bound historical icons. No limit truncates evidence. Missing/contradictory candidates remain subject to the original authoritative predicate.
2. Replace only related-job lookups in workflow_resolution_snapshot, workflow_resolution_legacy_draft_safe and manual_letter_icon_closed. The underlying base-table FOR UPDATE locks, their ordering, account/provider checks, full audit evidence, fingerprints and replay rules remain identical. No schema table/column/index changes.
3. Align manual_letter_icon_ready with the existing authoritative terminal-result check for completed non-icon helpers. Failed icons and parents still need cleared locks. Uploads must still be completed with validated execution evidence. Active, unknown, uncertain or malformed results remain blocked. Retained lock fields and all original evidence are preserved, never cleared.
4. Keep the five-second snapshot and ten-second confirmation limits. Return fixed timeout/unavailable categories; log only fixed snapshot/outcome fields. UI distinguishes session expiry, permission denial, timeout, backend unavailability and normal blocked eligibility. Raw errors, identifiers, request/response bodies and credentials are not displayed or logged. No automatic retry or confirmation is introduced.

Migration: supabase/migrations/20261111065449_manual_icon_eligibility_performance.sql. The previous Stage 2 migration remains unchanged. Five function definitions are involved: one new candidate helper and four replacements. Original association/confirmation/fence functions are not changed.

## Validation

The existing completion, permission, concurrency, immutable-audit and replay suite runs with the correction in disposable PostgreSQL. Added checks compare discovered job sets to the original association predicate, preserve conflicting/path/legacy cases, test 106,000 unrelated synthetic helpers under the actual five-second snapshot limit, and cover retained terminal locks versus active/uncertain outcomes. All triggers remain enabled; bulk fixture loading uses bounded transactions.

Mocked API/browser tests verify fixed timeout/error classifications, no raw-error leakage, no confirmation/retry following errors, and HTTP 200 blocked eligibility. Full relevant regression suite: 1,394 passed. Standalone TypeScript and synthetic-only full production build passed; 73 disposable PostgreSQL tests passed, including the 106,000-helper five-second snapshot and retained-lock cases. Local build output must not be deployed.

## Deployment after separate approval

Recheck the live source and prerequisite function definitions, then checkpoint the reviewed patch. Stage its exact source using the existing production Vercel environment without assigning domains. Verify file hashes/build/route guards. Apply only the corrective migration, verify the five bodies and service-role-only permissions, then promote. Do not reapply the old Stage 2 migration over this correction.

Open one existing eligible letter's preview without confirming completion; verify a timely HTTP 200 eligibility response. A normal blocked response remains blocked. Independently verify current Approved/Verification classifications remain correct. No actual completion, clinical approval change, job retry or external communication is a deployment test.

Rollback the dashboard to dpl_8oCTEumtoBqR6CYXhNoA12f3zdoV if needed. Prefer retaining the semantically equivalent performance lookup and validated-terminal-result correction: do not erase closure evidence or replay jobs. Any SQL reversal needs a separate reviewed migration restoring the four original function definitions before removing the new helper. No destructive reset or audit deletion.

## Remaining limits

The exact failed browser response body/RPC error was not captured; the deployed catch suppresses it. Request status/timing plus bounded database measurements establish the snapshot bottleneck. The new fixed categories make future attribution explicit. The corrected function definitions have been tested locally, not installed or called as a live authenticated preview. Final production preview verification follows separately approved deployment.
