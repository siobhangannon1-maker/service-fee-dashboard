# Batch 2 revised design — revision 2, external review required

**PAUSED: four profile-only Billing cases require individual authorization review.** Role-source equality is not a deployment requirement. See [role-normalization-review.md](role-normalization-review.md). All intended Billing users must have an approved canonical user_roles role, no legitimate Billing user may lose intended access, and RLS requires exactly one explicitly active status record.

**Production remains paused. SQL has now been validated only in a disposable local synthetic PostgreSQL cluster.** See [isolated-validation.md](isolated-validation.md) for results and limitations. These files remain outside supabase/migrations. No application, worker, production data or excluded subsystem changes.

## Files

- proposed-migration.sql — revised transactional policy/ACL proposal.
- aggregate-preflight.sql — read-only aggregate status/role counts; no identities.
- capture-rollback.sql — repeatable-read, read-only baseline metadata and historical restoration SQL generator; fails on missing relations or unsupported baseline.
- emergency-secure-containment.sql — option A: deny direct browser access while preserving anonymous denial and existing service-role operations. Operational outage tradeoff; not a browser functionality rollback.

## Corrections

1. Helper owner explicitly postgres; migration requires trusted postgres with RLS bypass, verifies owner/search_path/stability/security-definer flags, table SELECT and auth.uid EXECUTE. Client superuser/BYPASSRLS/CREATEROLE, ownership membership, service_role membership and CREATE on public/auth cause abort. Membership in auth.uid's owner also causes abort. No arbitrary actor parameters or dynamic SQL in the helper.
2. Effective EXECUTE checked: anon denied; authenticated allowed without grant option. PUBLIC and unexpected ACL grantees denied even if default ACLs supplied them. PUBLIC is not a login role: ACL grantee 0 is checked; anon's effective inherited privilege is checked separately. Client CREATE/ALTER/replace via ownership is rejected, not silently revoked on unrelated schemas. If schema CREATE precondition fails, stop for separate review.
3. user_roles/user_status client writes revoked at table and column level including TRUNCATE, with effective postconditions. Existing privileged RPCs remain separate audit work; this does not secure an independently vulnerable definer RPC.
4. Required service-role CRUD checked per operation before and after all revocations, with schema USAGE and BYPASSRLS. No assumption that a comma-separated privilege check means all operations. Nothing grants extra service privileges to make checks pass.
5. Browser UPDATE only targets active rows with deleted_at AND deleted_by null. Result is either still active with both null or soft-deleted with non-null timestamp and caller's auth.uid. Already deleted/inconsistent rows cannot be edited, restored, reattributed or re-timestamped by browser UPDATE. Hard DELETE/TRUNCATE unavailable. Normal active-row content edits remain allowed, as does setting content and deletion together; no remote write/replay is involved. No restoration workflow found or added.
6. Review-lock exclusion remains on old/new rows; writable columns exclude all verification/lock/creator fields. Separate service-role review/edit concurrency race remains unresolved and explicitly outside this RLS change.
7. Production preflight reports 35 auth users, each with exactly one non-null status row; zero missing/duplicate/null statuses. RLS now requires exactly one row with is_active IS TRUE. Missing/duplicate/null/inactive records deny. Role vocabularies differ by generation/granularity; user_roles remains the proposed canonical source without copying either direction. Four profile-only Billing cases require individual review. Three either-source Billing users are inactive (two canonical); do not reactivate them automatically.
8. Collision handling refuses every pre-existing same-name helper overload and any reserved billing_v1 policy on first application. A completion comment stores revision plus a fingerprint of helper definition/owner/ACL, target table ownership/RLS/ACLs, column ACLs, policies role attributes/memberships, public/auth schema ACLs and auth.uid definition/owner/ACL. Written only after assertions, in the same transaction. Exact unchanged completed state reports already-applied and aborts without writes; drift/partial/collision aborts differently. No CREATE OR REPLACE and no new state table. Marker is an operational drift check, not a defense against a malicious database owner.
9. Capture validates eight ordinary relations, pristine helper/policy namespace, service-role CRUD/bypass and supported grantors. Saves RLS/FORCE, raw ACLs (including grantors), column ACLs/types, policies, relation owners, absent helper/owner/ACL and service privileges under one repeatable-read snapshot. Non-postgres grantor restoration requires a bespoke script; never CASCADE through unknown chains.
10. Generated historical restore requires a separate unsafe-restoration acknowledgement, locks the targets and verifies the completed-state fingerprint before changes. Restores captured table/column effective ACLs, grant options, RLS and FORCE flags; original policies/owners were never removed. Completeness requires saving BOTH metadata and ALL ordered SQL rows. SQL Editor may show only last result; run/capture accordingly.

## Required service operations and evidence

| Table | Required effective service-role operations | Existing path |
|---|---|---|
| imports | SELECT INSERT UPDATE DELETE | import upload/process/detail/delete; production-sync |
| import_rows_raw | SELECT INSERT UPDATE DELETE | Preserve current broad CRUD; processing uses insert/delete, reads for diagnostics/report consumers. UPDATE retained as existing compatibility floor, not a newly identified processor operation. |
| import_rows_normalized | SELECT INSERT UPDATE DELETE | import processing, reporting, deletion; UPDATE retained as current compatibility floor |
| billing_period_imports | SELECT INSERT UPDATE DELETE | import association/processing/sync; UPDATE retained as current compatibility floor |
| patient_financial_entries | SELECT INSERT UPDATE DELETE | Preserve current server CRUD; review API uses SELECT/UPDATE. INSERT/DELETE retained as existing compatibility floor, not newly authorized operations. |
| billing_detail_entries | SELECT INSERT UPDATE DELETE | Afterpay staging/link/unlink/delete |
| user_roles | SELECT INSERT UPDATE DELETE | admin role upsert and delete-user route |
| user_status | SELECT INSERT UPDATE DELETE | admin status upsert/list and delete-user route |

Compatibility-floor checks are intentionally conservative given live broad service grants. They do not authorize new API actions. Failure aborts instead of silently granting rights.

## Permissions and workflow impact

- imports/raw/normalized: no PUBLIC/anon/authenticated access; restrictive server-only guard. Service paths retained.
- billing_period_imports: active admin/super_admin SELECT only, no browser mutations.
- financial entries/merchant fees: active staff/billing_staff/practice_manager/admin/super_admin read/insert/allowed-column update; no provider_readonly/typist patient-level access. Existing screens work across providers and no creator-only rule is invented.
- Browser SELECT intentionally retains authorized soft-deleted-row visibility. Normal existing page queries already filter deleted_at IS NULL. Global RLS hiding would change UPDATE/RETURNING behavior and historical visibility; not included without a tested workflow requirement. This is not erasure: an authorized staff caller can explicitly query deleted records, but cannot alter them. External reviewer must approve this read decision.
- Existing service review/unlock and authentication logic untouched. RLS does not fix their concurrency race or profiles/user_roles discrepancy.
- No change to patient_cost_entries, storage, views, other RPCs, MediRef, Report Writing, workers, Reception/Scribe/cron. Their unresolved risks remain.

## Aggregate preflight and execution gate

Run aggregate-preflight.sql only after operator approval for read-only production counts. It reports status cardinalities, null/inactive counts, Billing missing status, canonical-only/profile-only roles, disagreements and duplicate/multiple assignments. Status counts have been reviewed; canonical Billing authorization review remains pending. The role comparison assumes profiles.id is unique; confirm its live constraint. Counts are per auth user, not orphan role/status rows.

The proposal requires transaction-local acknowledgements. When execution is eventually approved, place the following INSIDE its transaction after BEGIN and before checks:

```sql
set local billing_v1.preflight_reviewed = 'yes';
set local billing_v1.canonical_billing_reviewed = 'yes';
```

These are manual deployment gates, not authentication controls. Do not insert them now. Strict active-status enforcement is fixed in the helper. Canonical-role acknowledgement means every intended Billing user has an approved role and all four profile-only cases were individually reviewed, not that role vocabularies match. The helper never trusts caller-controlled settings for eligibility.

## Version and rollback limits

Capture immediately before approved migration under a controlled no-DDL window. A repeatable-read capture is internally consistent but does not prevent DDL after capture; compare saved metadata before applying. Generated rollback rejects intervening drift covered by its manifest. Role memberships, schema grants and auth.uid are also fingerprinted; unrelated role changes conservatively require manual drift review before rollback. Re-run privilege checks before any operational rollback. Exact completed rerun is a safe failure/report, not a successful no-op migration.

A. Prefer forward correction of authorized access while retaining anon denial. emergency-secure-containment.sql is an emergency fail-closed alternative that temporarily disables direct Billing browser reads/writes. It is not a claim to restore UI service. No automatic execution.

B. Full historical restoration reinstates known unsafe anonymous privileges. Generated SQL requires `SET LOCAL billing_v1.allow_unsafe_restore='yes'` inside its transaction after BEGIN and before approval check, only after explicit emergency approval. Default output aborts. Saved capture must be complete and reviewed. After containment/drift, do not execute historical restoration blindly: its fingerprint check should fail.

## Validation plan

Initial isolated PostgreSQL validation is complete (195 checks); see isolated-validation.md. Before promotion, complete branch/live-shaped validation including: all roles and active-status edge cases; inherited privileges; default function grants; owner/schema replacement attempts; legacy broad permissive policies; INSERT RETURNING; active edit/soft delete/undelete denial; lock spoof/locked update denial; hard DELETE/TRUNCATE denial; service CRUD before/after; concurrent browser edit/review ordering; exact rerun, partial/collision/drift; missing baseline capture; full restore ACL comparison; containment preserves anon denial. Test updates with empty/minimal PostgREST responses and existing browser SELECT filters. Review defaults/triggers, constraints and any grant chains first.

Then rerun Batch 1 application tests/typecheck/build and staging Billing/import/entries/merchant-fee/Financials smoke tests. No real patient mutations or communications for tests. Static whitespace checks are not PostgreSQL execution validation.
