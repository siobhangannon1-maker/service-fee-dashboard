# Workflow enrichment stability — local review

Production baseline: deployment dpl_A2yeJYCzdbkD3cYG8J6DyTsJuePM, source e2b48326885a59ca172ad509e627695eb08962a0. Local commit and staging are authorised. No promotion, migration application, job retry or production write is authorised by this preparation.

## Confirmed cause

The existing five-second evidence deadline covers sequential audit discovery, completion projection, helper discovery and follow-up reads. A successful sample took 4.73 seconds, including about 0.60 seconds for audit discovery and 2.98 seconds for the completion RPC. An independent comparison reproduced a 5.04-second deadline with parent/child reads aborted. The prepared parallel read completed in 3.91 seconds with no failed reads, verifying 56 records as completed that the timed-out live-source pass presented as Approved. These were metadata-only read checks, not authenticated browser captures. They are samples, not a latency guarantee.

The production fallback marks the evidence unavailable but still partitions affected clinically approved records into Approved or Requires Verification. Thus an incomplete read appears to establish unfinished work. The localhost working directory also has unrelated resolver changes: a successful same-record comparison disagreed on ten classifications. Localhost counts are not the reference for clinical or delivery truth.

The administrative migration replaced workflow_resolution_projection by adding an administrative closure reader. It did not add/drop indexes or modify the job-association function. That projection now participates in these samples and costs 2–3 seconds, but these measurements do not isolate the incremental SQL cost of the new branch or establish an internal query-plan regression.

## Minimal correction

- Run the existing completion projection concurrently with independent helper discovery. Keep the same bounded reader, five-second deadline, safety RPC and failed-read handling. No extra evidence is trusted and no completion test is removed.
- Put clinically approved records with stale, absent or unavailable projections in a separate Status unavailable list. Neither Approved nor Requires Verification counts include them. Do not retain old completion as fresh evidence or infer completion from durable flags alone.
- Use neutral unavailable wording and suppress delivery-failure labels/recovery controls on those cards. Existing server-side action guards are unchanged.
- Coalesce overlapping background list reads per provider within one server instance, after each caller authenticates. Results are discarded after settlement. Foreground staff-action reads remain fresh; there is no TTL cache or automatic action retry. Independent browser polling loops can overlap today; this limits duplicated reads within an instance, not across Vercel instances.

This makes timeout classification safe even if slow reads recur; it does not promise that every request completes within five seconds. A future measured SQL optimisation or provider-scoped pagination can be reviewed independently if unavailable counts remain frequent. Do not increase the timeout or change database functions as a shortcut.

## Validation and review

1,416 Letters/MediRef/dictation regression tests passed, including synthetic 12 Approved / 45 verification / 75 completed records, failed enrichment, recovery after failure, concurrent evidence reads, manual-completion safety contracts, explicit confirmation, and foreground/background read separation. Standalone TypeScript, the full production build and git diff --check passed on the final source. Build uses synthetic credentials and a network guard. No real external actions are used in tests.

Browser acceptance after a separately approved staging deployment: select the provider, verify confirmed outstanding and verification lists; force a failed enrichment response using synthetic/local data and verify affected records appear only under Status unavailable with no retry controls. Restore evidence and verify normal classification. A genuine known icon failure remains Approved. Completed workflows are excluded only with valid existing evidence. Clinical approval fields and audit events must be unchanged.

## Release and rollback, after separate approval

Reconfirm live source baseline before release; stop/rebase if it changed. Review and commit only this patch. Build/stage exact source with the existing production configuration and verify source hashes, authentication guards, read-only provider classifications and signed-in UI. The enrichment change needs no migration. The combined manual-button correction below requires its single inspector migration before promotion. No Render change is required. Promote only with explicit approval. Current rollback dashboard is dpl_A2yeJYCzdbkD3cYG8J6DyTsJuePM; rollback needs no SQL changes and must preserve all administrative-completion events/fences. This patch changes presentation/read scheduling only, not clinical data or automation.

## Exact changed files

Runtime:
- app/(protected)/report-writing/typist/TypistPage.tsx
- app/api/report-writing/get-drafts/route.ts
- lib/report-writing/typist-approved-partition.ts
- lib/report-writing/typist-card-presentation.ts
- lib/report-writing/workflow-recovery.ts
- lib/report-writing/draft-list-inflight.ts

Tests:
- lib/report-writing/history.test.ts
- lib/report-writing/letters-stabilisation.test.ts
- lib/report-writing/typist-approved-partition.test.ts
- lib/report-writing/typist-card-presentation.test.ts
- lib/report-writing/workflow-enrichment-discovery.test.ts
- lib/report-writing/draft-list-inflight.test.ts
- lib/report-writing/workflow-uncertainty.test.ts

Documentation: docs/report-writing/workflow-enrichment-stability.md.

Prepared on branch fix/letters-enrichment-uncertainty in /Users/siobhangannon/docudental-letters-enrichment-stability. Release preparation permits a local commit and a staged build only; migration application and production promotion require separate approval.

## Follow-up: manual completion is only for started work

Confirmed defect: the old button condition was clinical approval AND not completed, so it also offered an override for not_started. The old locked inspector allowed no-start/no-job records too.

The shared canOfferManualWorkflowCompletion helper now requires clinical approval, available projection evidence and a known needs_attention/completing state. Both approved and uploaded_to_praktika remain supported. It never requires every branch to succeed. No main-panel placement change is included.

Local migration 20261115210757_manual_workflow_started_guard.sql replaces only inspect_manual_workflow_completion, retaining its signature, active-job locks, clinical approval, staff roles, lease/permit safeguards and service-role-only permissions. A recorded workflow_started_at or at least one already-associated helper is required. Raw failure/status flags alone do not prove start. This boolean enters the existing state fingerprint. The existing confirmation function calls the inspector under lock, so direct submissions and stale previews cannot bypass it; duplicate already-resolved submissions remain idempotent. Nothing rewrites old completion events or failed jobs. No new table, index, portal query or automated-success requirement.

Additional files: app/api/report-writing/complete-manual-workflow/route.ts (specific no-start reason), lib/report-writing/manual-icon-completion-api.test.ts, lib/report-writing/manual-workflow-visibility.test.ts, scripts/manual-workflow-administrative-db.test.py and the named migration; the UI/partition/card-test files listed above are extended in place.

Validation: 1,416 regression tests, standalone TypeScript, full production build and diff checks passed. All 74 disposable PostgreSQL tests passed. The suite covers never-started direct confirmation, failed/partially complete uploaded letters, stale previews, idempotency, concurrency, permissions, unchanged audit/jobs, existing completed resolutions and replay fences. No production schema/data changes or external actions ran.

Combined deployment after separate approval: verify unchanged production baseline; commit/review exact combined source; stage/build and verify source/health; apply ONLY 20261115210757_manual_workflow_started_guard.sql; verify inspector body/ACL; promote same staged release; inspect Ready/failed/completed/unavailable visibility without confirming any real letter. Never reapply the previous administrative-completion migration. Rolling back the dashboard does not require reverting this stricter guard; preserve every audit event and replay fence.
