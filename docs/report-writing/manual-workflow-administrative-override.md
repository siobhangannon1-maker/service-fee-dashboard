# Manual workflow completion: administrative override

Local preparation only. Branch fix/manual-workflow-administrative-override; worktree /Users/siobhangannon/docudental-manual-workflow-override. Base production commit 53e770fc59c0439265560ad8fddac8d9353c8045, deployment dpl_4HY7bdKXcbud9xa5S8TqfXHV8XuL. No production migration, deployment or data modification is part of this preparation.

## Staff experience

A clinically approved letter whose workflow is unresolved shows Mark Workflow Complete, including letters with no workflow started or failed/unknown automated steps. Clicking opens the dialog immediately and checks only authorisation and active external work.

The single required checkbox says: I confirm that all required workflow steps have been completed manually or independently verified.

On confirmation, the application records an administrative resolution. It does not assert that automation succeeded. All failed step flags, jobs, errors, approval decisions, letter/PDF fields and prior audit records stay unchanged. The workflow disappears from outstanding Approved and appears in completed History, with earlier automation evidence retained.

The fixed all-steps attestation is recorded as the manual completion reason, alongside the staff user ID and completion timestamp. No free-text patient information is requested. No external actions, retry, upload, note creation or MediRef send occur.

## Essential safeguards

- Both API and database require an active authorised typist/practice manager/admin/super admin. Actor identity comes from the authenticated server session, not the request body.
- Database confirmation requires clinical status approved/uploaded_to_praktika and a clinical approval timestamp. It never sets clinical status or approves a letter.
- Explicit allStepsConfirmed=true and an encrypted, expiring user/draft-bound preview are required. Confirmation rechecks current state under locks; changed letter/active state rejects stale previews.
- Only associated helper metadata and outstanding execution permits are checked. No requirement for a parent workflow, matching appointment cache, successful PDF/General Note/chart/MediRef result, or an artifact to exist in the app.
- Nonterminal/queued jobs and preparation markers block completion. A failed job with a newer/unbounded execution lease also blocks. A historical terminal failure is allowed even if its outcome is uncertain; a retained old lock is not treated as success proof.
- An untracked in-flight operation cannot be silently waived: an unsettled permit must bind to a terminal helper whose ending timestamp follows the permit. Otherwise the dialog stays blocked until the operation is stopped/reconciled safely. This is an execution-race guard, not an automated-success requirement.
- Draft and related helper locks serialize worker claims and completion. NOWAIT on helper rows returns an active-work block instead of deadlocking against a concurrent worker. Existing job/operation/audit fences prevent new work or replay after closure.
- Repeated/concurrent confirmation creates one completion event. A lost response requires refresh, never automatic retry.

## Data model and migration

Only supabase/migrations/20261111075316_manual_workflow_administrative_completion.sql is new. It creates four service-role-only functions (blocker, inspect, confirm and closure projection) and extends the existing workflow_resolution_projection to recognise the administrative closure. No new tables, columns, indexes or triggers. No backfill.

The event uses the established workflow_resolution_completed action and workflow-resolution-v1 envelope, plus manualCompletionContract=manual-workflow-completion-v1 and completionType=administrative_override. It records allRequiredStepsConfirmed, actorUserId, completedAt and the attestation reason. It creates no per-step success events or outcomes. Only workflow_status and updated_at on the draft change. Original clinical status and every original automated result remain intact.

The existing resolver/History recognise the administrative event. Failed branches remain failed/unknown while the overall workflow is administratively resolved; this does not establish automated delivery or external success. A new closure reader validates provenance and current letter fingerprint, retaining existing replay fences and the original automated evidence.

The previous icon-only functions remain installed to preserve existing completion evidence. The old API is retired with an authenticated refresh-required response; cached icon-only confirmations cannot attest to all steps. The old component export is a small source-compatibility alias to the new dialog.

## Changed files

- app/(protected)/report-writing/typist/TypistPage.tsx
- app/api/report-writing/complete-manual-workflow/route.ts
- app/api/report-writing/complete-manual-icon/route.ts
- components/report-writing/ManualWorkflowCompletionButton.tsx
- components/report-writing/ManualIconCompletionButton.tsx
- lib/report-writing/manual-icon-completion-api.test.ts
- lib/report-writing/letters-stabilisation-browser.test.ts
- lib/report-writing/typist-card-presentation.test.ts
- scripts/manual-workflow-administrative-db.test.py
- supabase/migrations/20261111075316_manual_workflow_administrative_completion.sql
- docs/report-writing/manual-workflow-administrative-override.md

The History page, approval partition, refresh/enrichment optimisation, dictation code and Render workers are unchanged.

## Validation

- 1,394 Letters/MediRef/dictation regression tests passed, including mocked browser tests for explicit confirmation, double-clicks, History movement, retained errors and safe error messages.
- 70 disposable PostgreSQL tests passed: failed/unknown non-icon steps, no parent/artifacts, clinical approval, authorisation, idempotency, active job/permit/preparation rejection, worker race, immutable audit and replay fences, and SQL-to-TypeScript History/Approved classification. No production credentials or TCP database connections used.
- Standalone TypeScript, full Next.js production build and git diff --check passed. The build used synthetic configuration and blocked production API access. Do not deploy its local build output.

## Controlled deployment after separate approval

1. Reconfirm the production baseline and review/checkpoint the exact patch. Stop/rebase if a newer production release exists.
2. Stage that exact commit with the existing Vercel production environment, without assigning domains. Verify uploaded source hashes and production build, including new/retired API authentication guards.
3. Apply only the named new migration through the normal Supabase migration process. Verify the four service-role-only helpers and the projection definition. Do not apply or rewrite old migrations.
4. Promote the verified staged dashboard. Check existing Approved/Verification counts before any staff action. Open the new dialog once without confirming; it should show the all-steps checkbox if no active work exists. Verify an active workflow remains blocked.
5. Staff may subsequently make a deliberate genuine completion only after independently confirming all required outside-app work. No real completion or external action is a deployment smoke test.

Rollback the dashboard to dpl_4HY7bdKXcbud9xa5S8TqfXHV8XuL if needed. Retain the additive functions, projection and all completion events once used: the baseline resolver understands generic manual closure events and existing fences preserve replay protection. Never remove audit evidence or reopen jobs to compensate. Any SQL reversal needs separate review, particularly after administrative resolutions.
