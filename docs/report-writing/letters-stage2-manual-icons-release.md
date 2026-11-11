# Stage 2: manual Praktika icon workflow completion

Prepared 11 November 2026. Local release preparation only; production migration and deployment require separate approval.

## Source and scope

Base commit: aa0a3919a6f79d83d1c606bd8f995f94caa54966.
Current production deployment verified before and after preparation: dpl_9FmuDJC7V1T7qJY4RenJUC1hENfa.
Durable branch: release/letters-stage2-manual-icons.
Worktree: /Users/siobhangannon/docudental-letters-stage2-release.

The eight implementation/test/migration files were transferred as a delta from 080f7e5fcf1435dcecf768574c5199811d10e2b0, whose parent is 98ff785. Both UI hunks applied cleanly. The older branch was not substituted for the production source. Only the synthetic database fixtures were adapted and extended; the original migration remains byte-identical, SHA-256 40cc613c3ca8b14779569e3cd81c7f101638722ef584dde66a7ac991985518bd.

The current workflow-recovery audit-discovery optimisation, Approved/Verification partition, refresh ordering and dictation implementation are unchanged. No watcher, browser transport, external workflow, dependency or environment-variable changes.

## Staff workflow

An approved letter needing attention offers Mark Workflow Complete. Clicking checks eligibility on the server. If any required non-icon step is incomplete, uncertain or active, confirmation is blocked with an explanation covering the linked appointment, active jobs, PDF, MediRef and chart requirements.

Eligible staff must explicitly confirm the appointment icon was already changed manually in Praktika. The dialog explains that this records verification without sending, uploading or retrying anything. A prepared MediRef step is explicitly labelled prepared, with sending unconfirmed; it is accepted only under the existing workflow's preparation-completion model. This feature never substitutes preparation for a failed or uncertain required send.

The locked confirmation atomically appends a verification event and an administrative completion event, including staff identity, time, original failed icon job and evidence fingerprints. Only workflow_status and updated_at on the draft change. Clinical status/approval, letter content, PDF references, parent/child job statuses, original errors and prior audit history remain intact. Duplicate/concurrent submissions acknowledge one completion.

Existing audit fences prevent resetting/requeueing the parent or failed icon helper, reserving new icon execution, or deleting completion evidence. The current resolver removes the completed letter from outstanding Approved. History labels it Workflow manually completed while retaining earlier failure evidence.

## Database compatibility and migration

Apply ONLY supabase/migrations/20261111021821_letters_icon_manual_completion.sql. Do not push unrelated migrations.

The migration creates five service-role-only helpers and replaces the existing read-only workflow_resolution_projection function to recognise the guarded manual closure. It adds no tables, columns or triggers and performs no backfill or external action. Confirmation is the only new mutating function; it runs only after a separately authenticated, active authorised staff request.

Live read-only inspection confirmed required report_letter_queue column types and existing workflow fences. The disposable fixture's pre-migration function definition MD5s exactly match live production:
- workflow_resolution_snapshot: ae8ddd871be10d9fac53f27096e22aae
- workflow_resolution_projection: faadcfc6a3708ac923f249b4464cb16f
- workflow_resolution_fenced: 8ed30af940c7700decd546520feb8672
- workflow_resolution_legacy_execution_safe: d0f481ba9de64b1b80226a8fa687c5b0

The new functions are not currently installed in production. Snapshot locking and active-account/role/provider checks are reused; no RLS policy or security-definer shortcut is introduced. PUBLIC/anon/authenticated execution is revoked. The function-only migration is transactional and repeatable, including after a completion, as tested locally.

## Validation

- 1,389 Letters/MediRef/dictation regression tests passed, including current Stage 1 enrichment tests and the mocked browser/API manual completion tests.
- 68 disposable PostgreSQL tests passed: preservation of every original job and clinical field, explicit confirmation, roles/inactive accounts, concurrent/duplicate completion, stale previews, active parent/all child types, unrelated failures, audit immutability, replay fencing and migration reapplication.
- SQL-to-TypeScript test uses an actual synthetic SQL confirmation/projection with modern deterministic helper IDs, then the shipped resolver and partition: outstanding Approved before, completed History projection after, clinical approval unchanged, failed icon job retained.
- Mocked Chromium UI checks disabled confirmation, single submission, truthful prepared-versus-sent wording, completed History filtering and retained original error.
- Standalone TypeScript, full Next.js production build and git diff --check passed. The local build used synthetic configuration and blocked production API access; do not deploy its .next output.

## Approved-release sequence (not performed)

1. Reconfirm both production domains still resolve to dpl_9FmuDJC7V1T7qJY4RenJUC1hENfa and verify the release commit parent is aa0a391. Stop if superseded. Recheck prerequisite function hashes/ACLs and that no conflicting migration was installed.
2. Stage the exact release commit on the existing Vercel project using its existing production environment, without assigning domains. Compare all uploaded hashes to that commit, check build success and unauthenticated route/guard health. No Render changes.
3. After explicit database/deployment approval, apply only the named migration transaction through the established production migration process. Verify the six function definitions, signatures and service-role-only ACLs using catalog reads. Do not call confirm_manual_letter_icon or create test jobs merely to verify deployment.
4. Promote the verified staged build. Check login, Letters routes and authentication guards. Reload the affected provider's portal; existing 33/0 classifications should remain unchanged until staff intentionally resolve an eligible letter. Counts may legitimately change with normal work.
5. A separately approved genuine manual resolution should verify one already manually corrected icon, check its move to History, staff/time audit and unchanged failed helper/error. Do not retry, upload or send anything as a smoke test.

## Rollback

Roll the dashboard back to dpl_9FmuDJC7V1T7qJY4RenJUC1hENfa (commit aa0a391). Keep the additive database functions and completion evidence, especially if anyone has used the feature: the baseline already understands generic resolution events, and retaining the projection and fences preserves closed workflows and replay protection. The old History UI may lack the new explanatory label; never remove audit events, reopen jobs or revert clinical fields to compensate.

No database rollback is normally necessary. If the migration itself fails, its transaction rolls back and promotion must stop. If a complete SQL reversal is ever required before any confirmation, treat that as a separate reviewed migration restoring the captured original projection definition and removing only the five new functions. Do not run a blanket down/reset or remove the projection after real manual completions.

## Decision

GO for controlled release after separate migration/deployment approval. No unresolved compatibility or validation blocker was found. There has been no production schema/data modification, external action, push or deployment during preparation.
