# Historical manual MediRef verification — local implementation

This is human external verification of historical correspondence, not proof that an old failed helper succeeded. It is separate from system historical reconciliation and the Praktika remediation project.

## Release boundaries

The migration and application changes require separate rollout approval. No production migration, reconciliation, job creation, correspondence, retention release or cleanup is authorized by this document.

Apply only `20260916050207_manual_historical_mediref_verification.sql` after reviewing its database tests and production prerequisites. It requires the existing historical infrastructure, postgres audit ownership/RLS, and revoked client audit mutation privileges. Deploy the resolver support separately. Verify privileges and zero new events before considering any import.

The import itself needs a separate approval for exact manifest bytes and an authorized current application session. Neither the migration nor runtime list lookup imports records. There is no permanent UI or scheduled importer.

## Contract

`verify_historical_mediref_completion(uuid,text,text,text,text,text,uuid,timestamptz,boolean default true)` accepts draft, expected epoch, current-state SHA-256, PDF identity SHA-256, workbook-row SHA-256, approved manifest SHA-256, current verifier ID, recorded human verification time, and dry-run.

The one-time tool resolves the verifier using Supabase Auth `getUser(token)` for each record. The RPC independently requires an existing auth user, exactly one active status, exactly one canonical admin/super_admin/practice_manager/typist role, and an active provider. Historical actors are never reused as verifier defaults.

The current-state hash is PostgreSQL SHA-256 over JSONB containing the full draft, relevant parent/upload/icon/MediRef jobs, upload audit evidence, relevant manual audit conflicts and duplicate icon evidence. The hash is computed inside PostgreSQL; clinical content is not returned in the manifest. Execution recomputes it under the existing advisory-lock protocol and a draft row lock.

PDF identity is SHA-256 of `manual-historical-mediref-pdf:v1\n` plus the exact historical attachment filename. This is an **identity hash, not a file-content hash**. The draft ID, epoch, complete source-state hash, failed job set and reviewed workbook row bind it to the intended correspondence.

Event identity is UUIDv5 in the existing historical namespace, with `draftId:epoch:manual-mediref-v1`. The protected event records human provenance, verifier, verification/import times, source hashes, all relevant failed MediRef job IDs and independently validated other-branch outcomes. It contains no fabricated MediRef result. Identical imports return the existing event; changed manifests/evidence conflict. New relevant activity creates a separate immutable invalidation event.

Unrelated administrative audit entries do not invalidate this evidence. Genuine draft changes, relevant source job/audit changes, new workflow/attempts and system reconciliation do. The original system retention audit validation and release contract are unchanged.

## Retention

Manual evidence always carries a hold. `release_manual_historical_mediref_retention(uuid,uuid,text,boolean default false)` is a separate service-only operation requiring a review reference and explicit execution. It is never called by the importer.

The reviewed workbook does not establish the time the letter actually arrived. `historicalCompletedAt` therefore remains null. The prior `workflow_completed_at` is preserved separately as recorded metadata; neither failed helper timestamps nor import time becomes a completion date. Unknown authoritative completion time still denies cleanup after a future hold release. A release alone does not invent that missing evidence.

## One-time importer

`scripts/manual-mediref-historical-reconciliation.ts` requires explicit private manifest, env and actor-token file paths. Keep the manifest/token outside the repository. It prints counts and fixed categories only. Do not put a token on the command line.

Dry-run (only after the migration is installed and dry-run is separately authorized):

```sh
npx tsx scripts/manual-mediref-historical-reconciliation.ts \
  --manifest /private/path/approved-manifest.json \
  --env /private/path/server-credentials.env \
  --actor-token-file /private/path/current-app-access-token
```

Execution additionally requires `--execute --approved-sha256 <exact-reviewed-file-hash>`. No default cohort or actor exists. The script stops a mutating batch on an unexpected result or database error. Re-run only after reviewing the failure; the deterministic RPC reconciles already verified entries.

The script permits only Auth user verification and this single database RPC. It has no job/continuation/external workflow capability. The seven NOT FOUND cases remain classified as historical MediRef remediation required; no resend action is implemented.

## Local validation

```sh
python3 scripts/manual-mediref-historical-db.test.py
python3 scripts/manual-mediref-historical-db.test.py --system-regressions
npx tsx --test lib/api-security.test.ts lib/report-writing/*.test.ts lib/mediref/*.test.ts 'app/(protected)/report-writing/history/history-status.test.ts' scripts/manual-mediref-historical-reconciliation.test.ts
npx tsc --noEmit
git diff --check
```

Database tests create disposable PostgreSQL 17 databases with synthetic records and never load application credentials. Frozen structural replay is kept privately, not in Git. Production state fingerprints were captured read-only; RPC execution and dry-run tests were performed only in disposable PostgreSQL.

Current frozen replay: 186 eligible; 158 whole-workflow completions; 7 Praktika blockers; 21 chart blockers; 186 holds; zero retention-eligible records. Seven NOT FOUND excluded. These are observed results, not hardcoded eligibility rules.
