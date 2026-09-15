# Security Hardening Batch 1 + Batch 2 — production deployment runbook

Prepared 2026-09-15 against local HEAD `5a79cb2` on `main`, with uncommitted changes. **PLAN ONLY: no deployment, Git mutation, production connection or database execution was performed in preparing this document.**

## Recommendation and release gates

**GO FOR PRODUCTION DEPLOYMENT APPROVAL:** scoped application/database authorization decisions are complete. This is not permission to deploy; final release, SQL, fresh baseline/rollback and backup approvals remain outstanding. The four private Billing-user decisions are COMPLETE: reviewed users 4; legitimate Billing access required 0; canonical role changes required 0; user_roles remains canonical; no profiles.role normalization required. Application-only containment may be separately approved while the remaining rollout decisions are completed; application guards do not close direct PostgREST exposure on RLS-disabled tables. Do not describe that intermediate state as complete containment.

| Gate | Classification | Required evidence |
|---|---|---|
| Four profile-only Billing cases decided privately | REQUIRED BEFORE DEPLOYMENT — Batch 2/combined | **COMPLETE per owner:** three provider_readonly and one typist require no Billing access; retain their roles. No identities copied into this runbook. |
| Canonical roles reflect intended Billing access | REQUIRED BEFORE DEPLOYMENT — Batch 2/combined | Every intended Billing user has an approved `user_roles` role; no unintended user acquires access. Any role changes require separate authorization, not this runbook. |
| Active-account coverage | REQUIRED BEFORE DEPLOYMENT | Every intended enabled user has exactly one status row with `is_active IS TRUE`; missing, duplicate, NULL or inactive records fail the Batch 2 helper. Do not reactivate deliberately inactive users. |
| Exact application changeset reviewed | REQUIRED BEFORE DEPLOYMENT | Batch 1 plus cleanup commit manifests, signed-worker compatibility, tests and build accepted; no unrelated changes or secrets. |
| Branch evidence accepted | REQUIRED BEFORE DEPLOYMENT | Branch `security-batch2-validation`, `lyascncfyqpfshszncao`: actual JWT/PostgREST evidence plus 865 tests, tsc/build/whitespace, 20 browser mutation checks, 18 HTTP checks, 16 page visits. Retain private detailed reports. |
| Exact SQL, capture and rollback reviewed | REQUIRED BEFORE DEPLOYMENT — Batch 2 | Approve hashes below and freshly generated production baseline/complete historical rollback; do not substitute the branch baseline. |
| Backup and drift plan ready | REQUIRED BEFORE DEPLOYMENT | Confirm available production backup/restore point and retention with operator; private metadata capture, controlled no-DDL window, reviewer and emergency decision-maker assigned. Do not create an unapproved production clone. |
| Release identity/environment/monitoring ready | REQUIRED BEFORE DEPLOYMENT | Approved production project ref and web release IDs, previous safe release, secure connection profile, on-call owner, monitoring access and worker auto-deploy controls confirmed. |
| Payroll import exact role allowlist approved and implemented | COMPLETE | Exactly active admin/super_admin/practice_manager; staff/billing_staff/provider_readonly/typist denied. Owner-approved existing manager boundary preserved. |
| Low-risk shared GET policy review | CAN FOLLOW AFTER CONTAINMENT | GET /api/benchmarks and GET /api/billing-periods may remain active-user-only temporarily. All 22 identified high-risk financial route files now require active Group A locally. See the final authorization review. |
| Additional excluded-system/privileged RPC and view reviews | CAN FOLLOW AFTER CONTAINMENT unless evidence shows a bypass of these controls | Track separately. If preflight finds an anonymous bypass to target data, stop the relevant rollout/claim of closure and review containment. |
| Delete validation branch | CAN FOLLOW AFTER CONTAINMENT | Only at the end of the approved rollback/observation window. |

`profiles.role = user_roles.role` is **not** a gate. The vocabularies differ. `billing_permission_only_in_profile` can remain nonzero when the owner deliberately declines Billing permission for those users; every case must be reviewed and no legitimate access lost. Batch 1 retains legacy missing-status compatibility; Batch 2 is stricter. The status preflight is therefore mandatory, not an assertion that Batch 1 alone already implements identical rules.

## Approved access matrix

| Workflow | Boundary to preserve |
|---|---|
| Billing, Financials, production-report import management | Group A: admin, super_admin |
| Patient Entries ordinary operations; Billing Details/manual fees; Afterpay imports | Group B: Group A + staff, billing_staff, practice_manager |
| Patient Entries review | billing_staff, practice_manager, admin, super_admin |
| Patient Entries unlock | practice_manager, admin, super_admin |
| Provider self-view | Existing own-provider scope; do not broaden |
| Statement email / service-fee invoice creation | Active Group A |
| Completion email | Active Group B |
| High-risk Xero/benchmark/report/import endpoints | Active Group A (22 route files tightened); see [endpoint matrix](financial-authorization-review.md) |
| Connecteam payroll import | Exactly active admin, super_admin, practice_manager; owner-approved and implemented |
| Shared GET benchmarks / billing periods | Active user acceptable temporarily; read-only definitions/calendar metadata |

Patient Entries branch symptom was a **test selector/filter error**, not a confirmed application refresh defect: the test selected the list's `fees_owed` filter while inserting another category. Reload reset the filter. Corrected form-scoped tests passed without reload; no speculative page/state changes belong in this release.

## Final authorization review addendum

[Complete endpoint matrix and must-fix disposition](financial-authorization-review.md). The four-user decision gate is complete without role changes or normalization. 22 existing route files were narrowed to active Group A by changing guard arguments only; production state was not accessed. Their file placement remains in the existing Batch 1/cleanup manifests, with the final reviewed contents. Connecteam now requires exactly active admin/super_admin/practice_manager. Xero/benchmark/import authorization review: COMPLETE. Four-user Billing review: COMPLETE (reviewed 4; Billing access required 0; canonical role changes 0). No endpoint-role or database authorization decision remains open within this scope; the release-control gates still apply.

## Exact changeset strategy

Use three reviewed commits, in order, on a dedicated release branch/isolated checkout created only when Git work is approved:

1. `Protect sensitive API access` — Batch 1 manifest below.
2. `Harden adjacent financial endpoints and lazy integration configuration` — cleanup manifest below. Depends on commit 1's helper. **Deploy commits 1 and 2 as one application release**, so build/configuration and guards travel together.
3. `Prepare Billing database access hardening` — Batch 2 migration design/docs/tests and this runbook. Keeping SQL under `docs/security/batch2/` does not apply it automatically.

The manifest is the complete current local changed/untracked file inventory grouped by purpose, not permission to commit. Compare every file/hunk before staging. The security changes in Report Writing/MediRef API consumers/tests are Batch 1 dependencies (in-process PDF/trusted continuation support), distinct from excluded local MediRef launcher work. Preserve existing worker authorization. Do not stage an entire directory, `git add .`, `git add -A`, or `git commit -a`.

For each future commit: stage **explicit manifest paths only**, then inspect `git diff --cached --name-only`, `git diff --cached --stat`, `git diff --cached --check`, and the entire `git diff --cached`. Stop on extra paths or mixed unrelated hunks. Run the application suite/typecheck on the cumulative commits and the branch-configured build at commit 2. Record resulting SHAs and deployed immutable release ID. No push/merge is authorized now.

Do not run broad `supabase db push` or a directory-wide migration command: the repository also contains unrelated historical/pending migrations. The reviewed Batch 2 file is the only SQL candidate. If a migration ledger entry is required by the deployment process, prepare and review that packaging separately before deployment; do not invent it during the window.

## Validation evidence and document precedence

The previously accepted branch/cleanup results are: **865/0 tests**, TypeScript pass, isolated `npm run build` pass, `git diff --check` pass; **20/20** create/immediate-display/edit/soft-delete assertions, **18** real-session endpoint checks, and expected outcomes across **16** page visits. No email, Xero, Praktika or MediRef external action was used to test. Missing branch branding assets produced storage errors, not Billing authorization failures.

`batch2/isolated-validation.md` records the earlier 195-check disposable PostgreSQL run and 742-test milestone; its “branch not yet executed” passages and README's local-only wording are historical, not the current rollout status. Accept this evidence addendum with the release. Do not claim every suggested extended scenario in that historical plan was executed. Before production, ensure the complete branch rollback comparison is retained/accepted privately; a migration pass is not itself proof of a rollback test.

Final authorization review adds **1158/0 local regression/security tests** after the 22 Group A restrictions and Connecteam closeout; TypeScript, isolated `npm run build`, and `git diff --check` passed. The prior branch HTTP/UI checks predate those restrictions and are not a live retest of the new role boundaries. Local actual-handler tests cover all 27 Group A methods with denied roles, plus admin/super_admin safe handler behavior in every requested category. Connecteam passes all ten required cases. Targeted financial tests: 265/265. Dependencies are synthetic, so this is not a new real-JWT branch test. No SQL was executed for this review. New verification SQL below remains a plan, not an executed production result.

## Production baseline — immediately before the approved window

1. Operator identifies the **production** Supabase project in its dashboard and approved secure connection profile. Record the verified ref privately in the change record. It must not be validation ref `lyascncfyqpfshszncao`. Do not infer project identity from database name `postgres`, a shared pooler hostname, a pasted credential or current CLI link. Compare the dashboard connection host/username mapping with the selected secure profile. Stop if uncertain.
2. Establish controlled no-DDL/role-grant-change window and ask operators to pause Billing imports/edits for the short migration window. Do not kill jobs or modify rows. Check for genuine active work; allow it to finish. Keep the migration's 5-second lock timeout.
3. Verify backup availability and recovery ownership; retain the prior application release. Store captures in an access-restricted location **outside Git**. Do not print credentials or identities into tickets/chat/CI.
4. Using only the reviewed, explicitly selected production connection, run the existing metadata/aggregate files separately and retain every result set:
   - `scripts/security/billing-access-preflight.sql`: relation types/owners/RLS, columns, table and column privileges, policies, roles/memberships, constraints/triggers, public function privileges, dependent views.
   - `docs/security/batch2/aggregate-preflight.sql` and `status-role-population-preflight.sql`: aggregate roles/statuses only.
   - `docs/security/batch2/capture-rollback.sql`: **exact reviewed capture**, repeatable-read/read-only, requires pristine helper/policy namespace and supported grantors. Captures eight targets including authorization tables; complete baseline JSON AND all ordered historical restore SQL rows are required.
5. Supplemental read-only function metadata (retain privately alongside capture; no function bodies/patient rows):

```sql
begin transaction read only;
select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as owner,
       p.proacl, p.prosecdef, p.provolatile, p.proconfig
from pg_proc p
where p.oid = 'auth.uid()'::regprocedure
   or (p.pronamespace='public'::regnamespace and p.proname='billing_access_level_v1')
   or p.oid in (
     select tgfoid from pg_trigger where not tgisinternal and tgrelid in (
       'public.imports'::regclass,'public.import_rows_raw'::regclass,
       'public.import_rows_normalized'::regclass,'public.billing_period_imports'::regclass,
       'public.patient_financial_entries'::regclass,'public.billing_detail_entries'::regclass,
       'public.user_roles'::regclass,'public.user_status'::regclass));
select nspname,pg_get_userbyid(nspowner) as owner,nspacl
from pg_namespace where nspname in ('public','auth');
commit;
```

6. Use a full-output client such as `psql`, not an SQL Editor export that silently retains only the last result. Example **future operator command**, after secure connection approval; `PGSERVICE` names a reviewed private profile (not a password/URL in command history):

```sh
# Set the private artifact directory and secure PGSERVICE through the operator's
# normal environment. Neither is inferred by this runbook. Do not set PGOPTIONS
# to supply or bypass migration acknowledgements.
umask 077
psql -X -qAt -v ON_ERROR_STOP=1 \
  -f docs/security/batch2/capture-rollback.sql \
  > "$SECURITY_ARTIFACT_DIR/baseline-and-restore.txt"
```

Only if psql exits 0: parse the first nonblank output line as baseline JSON; retain every subsequent line verbatim as ordered `historical-restore.sql`. Preserve the original combined output too. Check JSON has exactly eight expected relations and absent helper; verify restore begins `begin;`, ends `commit;`, includes the unsafe approval check and state fingerprint check. A truncated/failed capture is NO-GO. Never execute capture output as part of capture. SHA-256 all artifacts and privately review the full rollback. Do not “test rollback” on production.

7. Compare current baseline against the reviewed preflight: expected owners, RLS, policies/ACLs/column grants, enum/columns/constraints/triggers, service-role CRUD, schema/function ownership and role memberships. Original reported counts (35 users, complete status coverage, four profile-only cases) are historical expectations, not constants to force. Explain every change. Recapture/compare immediately before SQL if the window drifted; ignore capture timestamp but not authorization metadata. An unexpected helper, `billing_v1_*` policy, unsupported grantor or bypassing view/RPC is a stop condition, not permission to drop it.

## Deployment order — operator actions only after approval

A. **Application release first:** deploy the reviewed Batch 1 + cleanup SHAs to the web app via the normal approved release process. Preserve production secrets and existing integration flags. Confirm no Render worker restarts/auto-deploys are unintentionally triggered by a shared repository release; pin/exclude workers in the approved release process, not an ad hoc environment change. No worker change is required here.

B. **Verify web guards before database hardening:** use the API checks below. Check authorized read-only paths too. If any unauthenticated handler reaches data/side effects, stop. Do not proceed on the assumption that a frontend login proves API enforcement.

C. **Batch 2 only:** after final baseline/drift review, prepare a private execution copy of the exact hashed `proposed-migration.sql`. Insert only these two statements immediately after its existing `begin;`:

```sql
set local billing_v1.preflight_reviewed = 'yes';
set local billing_v1.canonical_billing_reviewed = 'yes';
```

Review a diff proving these are the only additions; record execution-copy SHA. Do not wrap its transaction in another transaction or put SET LOCAL in a separately committed request. Use the approved postgres connection with `psql -X -v ON_ERROR_STOP=1 -f <private-reviewed-execution-copy>`; capture exit status and SQLSTATE privately. No postcondition disabling, retry loop, CASCADE or rollback-on-error override. A failed/uncertain commit acknowledgement requires read-only state reconciliation before any further attempt. Exact already-applied rerun intentionally raises an exception; it is not successful idempotent apply.

D. **Database metadata then real HTTP verification:** run the read-only checks below. Confirm the completed revision state and all policy/ACL expectations. Do not rerun the migration to verify it.

E. **Legitimate read-only UI smoke:** perform the minimal checklist below with owner-approved existing accounts. Observe normal authorized business operations later; do not manufacture real patient entries/imports or communications for testing.

F. **Monitor for the first hour**, retain the branch and prior release/artifacts through the approved rollback window. Obtain operator sign-off before closing the window.

G. **Branch cleanup only after that window** and separate deletion approval.

Why this order: deployed service-role API guards must work before browser grants are narrowed; web authorization regressions are isolated before database changes. The database transaction then closes the direct anonymous paths without requiring new schema columns in the app. Web deployment alone does not protect direct Supabase access, so avoid an unattended gap between stages once all gates pass.

## Exact non-destructive verification order

### 1. Application HTTP checks (after A, before C; repeat after C)

Use a private browser/API client with normal secure session handling, no token copy into chat/logs. Disable automatic redirect following in the checker. Record only method, fixed route, status and pass/fail; discard response content.

| Principal / request | Expected |
|---|---|
| No cookie / deliberately invalid session: GET `/api/report-writing/get-drafts` | 401 JSON; no data |
| No cookie / invalid session: GET `/api/imports/list` | 401 JSON |
| Existing inactive account: same endpoints | 403 JSON |
| Active typist/billing_staff: GET `/api/imports/list` | 403 (Group A) |
| Active admin: GET `/api/imports/list` | Expected normal read response; inspect privately, log no records |
| Authorized Report Writing user: GET `/api/report-writing/get-drafts` | Expected normal history response; no body retained |
| Anonymous/invalid/inactive/wrong-role: POST `/api/email-statement` with `{}` | 401/403 as applicable |
| Active admin: POST `/api/email-statement` with `{}` | 400 missing input, before email; never supply a recipient |
| Anonymous/invalid/inactive: POST `/api/xero-benchmark-report` with `{}` | 401/401/403 |
| Active admin/super_admin: POST `/api/xero-benchmark-report` with `{}` | 400 invalid year; no processing or external action |
| Active typist/billing_staff/practice_manager: same empty POST | 403; no processing or external action |

The Xero benchmark route now requires **Group A**. An active typist must be denied before input processing. GET benchmark definitions and billing-period metadata remain explicitly active-only; do not confuse these with protected financial reports. No approval/send/workflow/upload/retry endpoints are invoked as successful production tests.

### 2. Database metadata checks (after C)

Run [production-verification.sql](production-verification.sql) as a **read-only inspection**, not a migration. Review all result sets; missing rows/NULL results are failures, not passes. Required:

- All eight target relations exist with RLS on and expected owner; FORCE state matches baseline (FORCE is not newly required).
- Anon has no effective table/column privileges on six Billing targets; no effective SELECT on user_roles/user_status and no client mutations on those sources.
- Helper exactly `public.billing_access_level_v1()`, postgres owner, STABLE SECURITY DEFINER, `search_path=pg_catalog, pg_temp`; anon/PUBLIC denied EXECUTE; authenticated/service allowed, authenticated no grant option. Completion marker present. Marker presence alone is not fingerprint proof; compare full metadata and recorded successful migration assertions.
- Service role retains each of SELECT/INSERT/UPDATE/DELETE on all eight tables plus schema USAGE and expected RLS bypass.
- Source imports/raw/normalized have no browser privileges. `billing_period_imports` has intended authenticated SELECT constrained to helper level 2, no browser mutations.
- Compare restrictive role/lock/deletion policies and allowed INSERT/UPDATE column sets against exact reviewed SQL; old permissive policies alone are not enough. Review/verification columns remain nonwritable. Do not run production UPDATE/DELETE/TRUNCATE to prove denial, even inside a rollback transaction (triggers/external effects may not roll back).

### 3. Real Supabase/PostgREST checks (read-only, no row values logged)

Use the production publishable/anon credential through secure tooling, **without a user session**. Never use a service-role key for the anon test.

- GET `/rest/v1/<table>?select=*&limit=0` for all eight targets. Expected permission denial (normally 401 for anon; record actual status). `limit=0` prevents patient results even if a grant is wrong. A successful 200 is a failure of the intended ACL denial, even with an empty array. Combine with catalog checks; empty data alone is not proof of safety.
- POST `/rest/v1/rpc/billing_access_level_v1` with `{}`: anon denied. The helper is read-only; no user-id parameter. A 200/0 for anon is still an EXECUTE-grant failure.
- Via existing approved users' normal JWTs, call that same read-only RPC: active billing_staff 1; admin/super_admin 2; typist 0; an already inactive Billing user with a still-valid existing session 0. Do not enable/reactivate/create an account or impersonate a user via forged SQL claims just to test. If inactive JWT unavailable, retain accepted branch coverage and report the live check unexecuted; use metadata/aggregate inspection, not a fabricated pass.
- Active admin GET billing_period_imports read succeeds; ordinary billing_staff receives no rows under RLS. Typist/inactive SELECT patient_financial_entries and billing_detail_entries must expose no protected data. Use a known existing row selected privately by the operator when proving RLS exclusion; request only a HEAD/count response and never log its identifier or body. No new synthetic production records. Authorize the existing row is otherwise visible to the corresponding allowed user; an unknown/empty table is inconclusive.
- For service role, metadata proves CRUD grants; verify a legitimate read-only Group A server API (imports/list) works. Do not execute production CRUD/import processing as a test. Branch synthetic CRUD is the write-behavior evidence.

### 4. Operator UI smoke (read-only)

- Admin `/billing`: page, existing period and statement information load. Do not click email, invoice creation, close period or export to external integrations.
- Admin `/financials`: expected existing report data load; no Xero sync/import action.
- Billing staff `/patient-entries`: existing allowed entries load; matching period/filter selection; no insert/edit/delete/review/unlock. Locked controls remain appropriate.
- Billing staff `/billing-details`: existing details/manual-fee data load and normal deleted-row filtering; no mutation.
- Admin production import management: existing import list/detail load; no upload/process/delete/link/unlink.
- One authorized Report History view: list opens with expected durable workflow status; no Complete Workflow, resend or external retry.
- Confirm billing_staff still denied `/billing` and `/financials`; typist/inactive cannot retrieve protected rows (an empty UI shell is not data access).
- Review console/server status codes without patient bodies. Escalate unexpected 401/403, column-grant/RLS errors or server-role failures. Do not “fix” a restriction by granting broad authenticated access.

## Failure and rollback decision tree

**A — App failure before Batch 2:** stop database rollout. Prefer a corrected guarded application release. If application rollback is operationally necessary, operator approves rollback to the recorded release and acknowledges any guards lost. Use approved access restriction/maintenance containment rather than reopening anonymous vulnerable APIs silently. Recheck endpoint denial before resuming.

**B — Migration transaction fails:** with ON_ERROR_STOP and the file's transaction, uncommitted changes roll back when the connection exits. Stop; compare metadata with the captured baseline, including helper/policies/ACLs. Lock timeout does not justify removing the timeout. If connection loss makes COMMIT uncertain, inspect completed-state metadata before deciding; do not blindly rerun or restore. A known baseline state retains the old exposure and is not a successful security deployment.

**C — UI regression but anonymous denial intact:** keep security controls, investigate exact role/column/policy/config issue, use a narrowly reviewed forward fix. Do not restore broad authenticated policies or anonymous grants. If urgent isolation is required, separately approve `batch2/emergency-secure-containment.sql`: this deliberately disables direct Billing browser access while preserving server-role operation; it is an outage containment option, not a functionality rollback.

**D — Severe issue requiring historical database restoration:** explicit emergency approval and acceptance of renewed exposure are mandatory. **The captured historical rollback restores known insecure anonymous grants and RLS-OFF states.** Block the affected public access through an approved containment measure first. Verify complete correct-project baseline, current fingerprint and absence of intervening drift; do not bypass drift checks. Only then may the emergency operator add `SET LOCAL billing_v1.allow_unsafe_restore='yes';` immediately after the generated rollback's BEGIN and execute the reviewed copy. No automatic fallback. Re-verify state, communicate the reopened exposure and restore secure controls urgently. Historical rollback does not undo legitimate business rows and is not interchangeable with point-in-time data restoration.

## First-hour monitoring and stop criteria

Record deployment and migration times/release IDs without personal data. Observe at 0, 5, 15, 30 and 60 minutes; named operator remains available.

- Group status counts by fixed route and 401/403/5xx; distinguish expected blocked anonymous traffic from failures of approved users. Compare pre-release traffic baseline; do not treat every 403 as an incident.
- Billing/Financials and entry/detail UI loading errors; RLS/column-permission failures; server-role API failures.
- Normal, independently authorized import-processing operations and Report Writing reads; inspect only status/fixed code. Do not initiate imports/communications to generate monitoring evidence.
- Watch signed continuation/worker authentication errors passively; do not restart workers or replay jobs.
- Any anonymous protected-data success or guard bypass: incident/containment immediately. Any repeatable legitimate Billing outage: stop progression, diagnose/forward-fix; do not weaken permissions.
- No patient names/DOB/content, emails/phones, identifiers, bodies, cookies, credentials, signed URLs or raw query strings in monitoring exports. Existing sensitive logs must be handled privately, not copied into this runbook.
- At 60 minutes, record checks, exceptions, responsible owner and approved rollback-window end. Continued normal monitoring remains necessary.

## Branch deletion point

Keep `security-batch2-validation` / `lyascncfyqpfshszncao` unchanged for now. Delete only after production application + database deployment, successful verification/observation, accepted private baseline/rollback retention, no unresolved reproduction need, **and the owner-defined rollback window has expired**. Deletion requires separate explicit approval; 60 minutes alone is not the deletion trigger. Do not merge the branch into production.

## Reviewed artifact fingerprints

Freeze/re-review if any artifact changes. The operator acknowledgement execution copy will have a separately recorded hash.

- `docs/security/batch2/proposed-migration.sql`: SHA-256 `19baeb5cef76c2b8251b1537461edeae383bfa92c3d71fe29114cc9df1765458`
- `docs/security/batch2/capture-rollback.sql`: SHA-256 `5626ade7c4819cffbb9ff49e8f679b952f97c83a92d3b2a251a80e7d75cf10ba`
- `docs/security/batch2/emergency-secure-containment.sql`: SHA-256 `8e3dd7f23a43450bf247e12b225484760558d1ba592b04aea090a50968e01fe3`

## Commit 1 — Batch 1 application/auth

91 paths:

```text
app/api/afterpay-imports/delete/route.ts
app/api/afterpay-imports/link/route.ts
app/api/afterpay-imports/route.ts
app/api/afterpay-imports/unlink/route.ts
app/api/afterpay-imports/upload/route.ts
app/api/billing-periods/route.ts
app/api/imports/[importId]/process/route.ts
app/api/imports/[importId]/route.ts
app/api/imports/linked-production/route.ts
app/api/imports/list/route.ts
app/api/imports/upload/route.ts
app/api/monthly-gross-production/route.ts
app/api/patient-entries/review/route.ts
app/api/patient-entry-creators/route.ts
app/api/praktika/production-sync/route.ts
app/api/providers/[providerId]/metrics/[importId]/route.ts
app/api/report-writing/admin/auto-tag-provider-examples/route.ts
app/api/report-writing/admin/provider-examples/delete/route.ts
app/api/report-writing/admin/provider-examples/route.ts
app/api/report-writing/approve-draft/route.ts
app/api/report-writing/audit/route.ts
app/api/report-writing/classify-report-type/route.ts
app/api/report-writing/correspondence-types/route.ts
app/api/report-writing/current-provider/route.ts
app/api/report-writing/debug-praktika-appointments/route.ts
app/api/report-writing/delete-draft-image/route.ts
app/api/report-writing/delete-draft/route.ts
app/api/report-writing/email-secure-pdf/route.ts
app/api/report-writing/generate-pdf/route.ts
app/api/report-writing/generate/route.ts
app/api/report-writing/get-audit-events/route.ts
app/api/report-writing/get-draft-images/route.ts
app/api/report-writing/get-drafts/route.ts
app/api/report-writing/get-history/route.ts
app/api/report-writing/get-providers/route.ts
app/api/report-writing/get-referrer-email/route.ts
app/api/report-writing/get-referrers/route.ts
app/api/report-writing/hydrate-letter-queue/route.ts
app/api/report-writing/letter-queue/enrich-praktika/route.ts
app/api/report-writing/letter-queue/route.ts
app/api/report-writing/letter-queue/sync-praktika/route.ts
app/api/report-writing/letter-queue/sync/route.ts
app/api/report-writing/list-typists/route.ts
app/api/report-writing/match-praktika-patient/route.ts
app/api/report-writing/mediref-tools/status/route.ts
app/api/report-writing/praktika-clinical-notes/route.ts
app/api/report-writing/praktika-referrals/latest/route.ts
app/api/report-writing/provider-behaviours/consolidate/route.ts
app/api/report-writing/provider-behaviours/delete/route.ts
app/api/report-writing/provider-behaviours/route.ts
app/api/report-writing/provider-examples-for-generation/route.ts
app/api/report-writing/provider-knowledge/delete/route.ts
app/api/report-writing/provider-knowledge/route.ts
app/api/report-writing/provider-letter-preference/route.ts
app/api/report-writing/provider-report-type-settings/route.ts
app/api/report-writing/provider-training-cases/analyze-provider/route.ts
app/api/report-writing/provider-training-cases/delete/route.ts
app/api/report-writing/provider-training-cases/route.ts
app/api/report-writing/provider-training-cases/train-loop/route.ts
app/api/report-writing/provider-training-cases/train-provider-behaviours/route.ts
app/api/report-writing/provider-training-cases/train-provider-knowledge/route.ts
app/api/report-writing/provider-training/delete/route.ts
app/api/report-writing/provider-training/route.ts
app/api/report-writing/referrers/import/route.ts
app/api/report-writing/referrers/search/route.ts
app/api/report-writing/referrers/sync-praktika/route.ts
app/api/report-writing/retry-mediref/route.ts
app/api/report-writing/save-draft/route.ts
app/api/report-writing/send-sms-notification/route.ts
app/api/report-writing/send-via-mediref/route.ts
app/api/report-writing/smart-dictate/route.ts
app/api/report-writing/transcribe/route.ts
app/api/report-writing/universal-rules/delete/route.ts
app/api/report-writing/universal-rules/route.ts
app/api/report-writing/update-draft-image/route.ts
app/api/report-writing/update-draft/route.ts
app/api/report-writing/update-praktika-letter-icons/route.ts
app/api/report-writing/upload-draft-image/route.ts
app/api/report-writing/upload-to-praktika/route.ts
app/api/report-writing/workflow-status/route.ts
app/api/xero-imports/delete/route.ts
app/api/xero-imports/link/route.ts
app/api/xero-imports/route.ts
app/api/xero-imports/unlink/route.ts
app/api/xero-imports/upload/route.ts
docs/security-hardening-batch1.md
lib/api-security.test.ts
lib/auth.ts
lib/mediref/enqueue-preparation.test.ts
lib/report-writing/history.test.ts
lib/report-writing/workflow-safety.test.ts
```

## Commit 2 — cleanup

26 paths:

```text
app/api/benchmarks/route.ts
app/api/connecteam/payroll-totals/import/route.ts
app/api/email-statement/route.ts
app/api/expense-benchmark-check/route.ts
app/api/expense-benchmark-report/route.ts
app/api/kpi-benchmarks/route.ts
app/api/run-xero-upload-benchmark-flow/route.ts
app/api/send-completion-email/route.ts
app/api/test-xero-mapping/route.ts
app/api/xero-account-mappings/route.ts
app/api/xero-benchmark-report/route.ts
app/api/xero-benchmark-reports/route.ts
app/api/xero/create-service-fee-invoices/route.ts
app/api/xero/debug-accounts/route.ts
app/api/xero/debug-labour-hire/route.ts
app/api/xero/labour-hire-sync/route.ts
app/api/xero/list-contacts/route.ts
app/api/xero/list-tenants/route.ts
app/api/xero/process-profit-and-loss/route.ts
app/api/xero/sync-profit-and-loss/route.ts
app/api/xero/test-connection/route.ts
docs/security/financial-authorization-review.md
lib/financial-authorization.test.ts
lib/microsoft/graph.ts
lib/security-predeployment.test.ts
lib/xero.ts
```

## Commit 3 — Batch 2 migration design/docs/tests and runbook

17 paths:

```text
.gitignore
docs/security-hardening-batch2.md
docs/security/batch2/README.md
docs/security/batch2/admin-role-review.sql
docs/security/batch2/aggregate-preflight.sql
docs/security/batch2/capture-rollback.sql
docs/security/batch2/emergency-secure-containment.sql
docs/security/batch2/isolated-validation.md
docs/security/batch2/proposed-migration.sql
docs/security/batch2/role-normalization-aggregates.sql
docs/security/batch2/role-normalization-review.md
docs/security/batch2/status-role-population-preflight.sql
docs/security/production-deployment-runbook.md
docs/security/production-verification.sql
scripts/security/billing-access-preflight.sql
scripts/security/test-branch-postgrest.mjs
scripts/security/validate-billing-rls.py
```

## EXCLUDED — unrelated work and local evidence; do not stage

27 paths:

```text
billing-patient-1h.jsonl
billing-patient-24h.log
generate-pdf-24h.jsonl
get-draft-images-24h.jsonl
get-drafts-24h.jsonl
get-drafts-24h.log
get-history-24h.jsonl
letter-queue-24h.jsonl
lib/praktika/README-helper-lease.md
lib/praktika/README-session-authorization.md
mediref-test-1h.jsonl
mediref-test-24h.log
mediref-test-draft-24h.jsonl
mediref-test-send-24h.jsonl
mediref-test-upload2-24h.jsonl
report-writing-1h.jsonl
report-writing-24h.log
scripts/README-praktika-gst-diagnostic.md
scripts/README-praktika-referring-parties-diagnostic.md
scripts/mediref-dob-diagnostic-local.test.ts
scripts/mediref-dob-diagnostic-local.ts
scripts/praktika-gst-diagnostic.js
scripts/praktika-gst-diagnostic.test.ts
scripts/praktika-referring-parties-diagnostic.js
scripts/praktika-referring-parties-diagnostic.test.ts
vercel-1h.jsonl
vercel-24h.jsonl
```

The `.gitignore` hunk in commit 3 only excludes `.env.branch-validation.local`; the environment file itself must never be staged. No source change to `app/patient-entries/page.tsx` is part of this cleanup. Private baseline outputs, temporary browser scripts and branch credentials are excluded from all commits. Re-run the inventory before actual staging; new paths require review.
