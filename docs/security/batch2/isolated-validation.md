# Batch 2 isolated validation

Production remains paused. No production connection or Supabase branch was used.
Executed against disposable local PostgreSQL 17 with synthetic rows only, using
an explicit private Unix socket and TCP disabled. The harness ignores PG*
environment variables, does not read .env and accepts no remote DSN. Cluster is
stopped and its temporary directory removed after the run.

## Results

- 195 isolated PostgreSQL checks passed.
- Batch 1 API/application regression suite: 742 passed, 0 failed.
- npx tsc --noEmit: passed.
- git diff --check: passed.
- Production build not rerun: no application/TypeScript implementation changed.
- This does NOT claim Supabase branch/PostgREST/browser end-to-end validation.

Run locally on the current Mac with PostgreSQL 17 installed:

```sh
python3 scripts/security/validate-billing-rls.py
```

Application suite:

```sh
npx tsx --test lib/api-security.test.ts lib/report-writing/*.test.ts lib/mediref/*.test.ts lib/praktika/route-security.test.ts lib/praktika/session-authorization.test.ts lib/user-role-security.test.ts
npx tsc --noEmit
```

## Coverage actually executed

- Anon SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all six Billing targets denied;
  anon cannot invoke the privileged access helper.
- Active admin/super_admin/staff/billing_staff/practice_manager allowed intended
  patient-entry/merchant-fee reads, body inserts with RETURNING and updates.
- Typist/provider_readonly, inactive, missing, NULL and duplicate status fixtures
  deny eligibility and patient-data SELECT/INSERT access.
- Only admin/super_admin can SELECT billing_period_imports; browser link writes
  denied. Raw/normalized/import tables reject browser reads/writes.
- Browser hard delete denied; wrong deletion actor denied; soft delete works;
  subsequent edits, restoration, timestamp change and actor change update zero rows.
- Locked patient entry cannot be edited; INSERT/UPDATE of every verification/review
  field denied by column grants.
- Effective service-role CRUD checked for all eight tables; actual rolled-back
  service CRUD executed on each. Browser role/status deletion denied.
- Historical broad and duplicate permissive policies remain in fixtures, proving
  restrictive conditions still constrain access.
- Missing acknowledgement rejects migration; transaction leaves no helper.
- Successful migration, exact already-applied rerun refusal, baseline capture and
  explicitly authorized isolated historical restore all executed.
- Full captured baseline metadata matches after restoration, treating ACL/policy
  array order as irrelevant. Includes owners, RLS/FORCE, ACL grantors/grant options,
  column ACLs/types, policies and service privileges.

## Runtime failures and revisions

1. Initial cluster startup was blocked by sandbox shared-memory restrictions.
   Reran with approved local execution privileges. No remote database was used.
2. Migration failed with SQLSTATE 42725: ambiguous text concatenation with
   pg_policy.polcmd (internal PostgreSQL char type) in the completion fingerprint.
   Added explicit polcmd::text in both migration fingerprint copies and the
   generated rollback fingerprint. Transaction aborted; fresh cluster rerun passed.
3. Initial exact JSON baseline comparison failed because restored ACL entries had
   different ordering. Corrected the test to compare unordered arrays semantically,
   preserving each privilege/grantor/grant-option value. No permission restoration
   change was needed; semantic comparison passed.

## Supabase branch/dev plan — not yet executed

1. Use a dedicated nonproduction project/branch whose project reference is manually
   confirmed against production and is different. Prefer a schema-only branch;
   never copy patient rows, integration secrets, storage files or auth identities.
2. Recreate actual eight target table definitions, role enum, defaults, constraints,
   triggers, policies/ACLs and relevant auth.uid behavior. Verify role/grant setup
   matches the production preflight. The local fixture omits real foreign keys,
   defaults/triggers beyond those needed for the tests and uses simplified import
   row columns. Compatibility with those real definitions remains unproven.
3. Create synthetic test accounts for all permitted/disallowed roles and status
   cases in the branch only. Do not grant production service credentials to tests.
4. Run baseline capture; review role/status aggregates. For the branch transaction
   only, acknowledge the two migration gates and apply the proposed design.
5. Through branch PostgREST, use anon key and real synthetic user JWTs (not forged
   SQL settings). Repeat the privilege matrix and soft-delete/RETURNING tests.
   Record status, counts and assertion outcomes only; do not log tokens or bodies.
   SELECT denied by RLS can be 200/empty; use known synthetic rows to distinguish
   denial from an empty dataset. Mutation denials may be errors or zero affected
   rows; verify actual stored state with trusted branch-only checks.
6. Run the web app against branch credentials in a dedicated dev environment;
   disable outbound integrations, workers, email/SMS and cron execution. Exercise
   Billing/Financials reads, patient-entry/merchant-fee insert/edit/soft delete,
   review-lock rejection and protected import upload/process with synthetic files.
   Confirm normal UI filters exclude deleted records. Do not run Complete Workflow
   or real external uploads merely to test Billing access.
7. Verify Batch 1 HTTP 401/403 responses with real branch sessions and accepted
   server-role routes. Local regression tests use I/O doubles and do not replace
   this deployed HTTP/session test.
8. On branch only, test snapshot/rollback, defaults/trigger behavior, concurrent
   review versus browser edit, inherited/default grants, drift/collision cases,
   and secure containment before production consideration. These extended scenarios
   are not all covered by the 195 checks. Verify private baseline records retained.

## Production assumptions still unresolved

- Individual authorization decisions for the four profile-only Billing cases.
  Role-source equality is NOT required; every intended Billing user must have an
  approved canonical role and no legitimate required access may be lost.
- Actual default/trigger/constraint behavior and object ownership/membership/ACLs
  must match design preconditions. The owner must be trusted postgres and service
  role must have required effective privileges independently of RLS bypass.
- All intended enabled users must have exactly one explicitly active status row;
  no automatic reactivation of the known inactive users.
- Service-role review API concurrency race remains outside this change.
- Supabase JWT/HTTP/UI integration remains to be validated on a branch.
- Excluded patient_cost_entries, privileged views/RPCs, storage and other modules
  remain separate exposure reviews; this migration does not secure them.

## Exact production deployment checklist — no execution authorized

1. Resolve and document the four manual Billing authorization decisions privately.
2. Repeat aggregate status coverage; approve strict status and canonical-role
   eligibility. Do not require profiles.role equality or automatic copying.
3. Complete the branch HTTP/browser tests above and external SQL review; approve
   exact migration and rollback artifacts including the polcmd cast correction.
4. Verify Batch 1 is actually deployed and authenticated service-role API paths
   function. Local tests are not evidence of production deployment.
5. Capture production baseline immediately before the approved window; verify all
   expected relations and supported grantors, save complete metadata/restore SQL,
   compare for intervening DDL and confirm effective service privileges.
6. Obtain explicit production application approval. Promote only the reviewed
   design to the migration process; supply acknowledgement settings inside its
   transaction. Keep the 5-second lock timeout and postconditions. On failure stop;
   transaction rollback must preserve baseline. Do not bypass failed assertions.
7. Perform anonymous status/count-only PostgREST checks and authorized read-only UI
   smoke checks. Denied roles must not retrieve known accessible fixtures. No
   production destructive denial tests or automatic real import mutations.
8. Monitor legitimate operator-approved Billing operations and safe authorization
   outcomes. Do not log patient bodies or tokens.
9. If correction is needed, prefer reviewed forward correction preserving anon
   denial. Secure containment disables direct browser access; historical restore
   reopens known exposure and requires explicit emergency approval. Never silently
   run either response. Recheck drift before any rollback.
