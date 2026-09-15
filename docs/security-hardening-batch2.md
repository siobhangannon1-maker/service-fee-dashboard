# Batch 2: billing access map and migration gate

Status: dependency review and read-only production preflight prepared. **No migration prepared or applied yet.** Batch 1 code is unchanged. No patient rows inspected. No live Supabase tool is callable in this session.

## Evidence boundaries

- Operator-supplied production findings: RLS disabled on imports, import_rows_raw, import_rows_normalized, billing_period_imports; approximately 99,000 normalized rows. Not independently queried here.
- Repository facts: the dependencies below; existing role/status helpers; no complete baseline definitions, policies or ACLs for these billing tables in repository migrations.
- Unknown: live table/column grants, inherited privileges, policies, trigger protections, dependent views/functions and patient_cost_entries existence/shape. RLS disabled is a vulnerability if an exposed role has access; effective anonymous access has not been independently tested.
- `202609090002_user_roles_server_only.sql` hardens user_roles writes but preserves SELECT policies/grants. It does not establish user_status or profiles write protection. Never trust a role/active-state source in RLS until its integrity is verified.

## Core access map

R/I/U/D below mean SELECT/INSERT/UPDATE/hard DELETE. A UI Delete is an UPDATE of deleted_at/deleted_by, not a SQL DELETE.

| Table | Repository / reported production RLS, policies and grants | Browser R | Browser I | Browser U | Browser D | Server/service-role dependencies | Worker/background | Supported role needs | Sensitive content |
|---|---|---|---|---|---|---|---|---|---|
| imports | No baseline found; RLS disabled reported; policies/ACL unknown | None found | None | None | None | imports list/upload/detail/linked-production; processImport; Praktika production-sync. Read/insert/update/delete and storage metadata | No direct worker dependency found; processImport is API-triggered, not a confirmed independent watcher | Import API admin/super_admin; production-sync retains existing actor checks | File metadata may identify patients; treat as sensitive |
| import_rows_raw | Same | None found | None | None | None | processImport replaces/inserts raw rows; import deletion deletes them; production-sync inserts | No direct watcher references found | Server-only; no browser permission needed by located code | raw_json stores entire source rows |
| import_rows_normalized | Same | None found | None | None | None | processImport; import deletion/list counts/linked-production; provider metrics API; production-sync; practice-manager staffing reports (service role) | No direct watcher references found | Server-only; admin reporting and practice-manager service reads preserved | patient_name, service date, description, amounts, normalized_json |
| billing_period_imports | Same | BillingClient | None found | None | None | imports endpoints/processImport; production-sync insert/delete; service-role staffing reports | No direct watcher references found | Browser admin/super_admin reads; service operations retain their endpoint permissions | Link metadata; protects access to sensitive imported data |
| patient_financial_entries | RLS/policies/ACL not established | patient-entries; BillingClient; FinancialsClient | patient-entries | patient-entries edit and soft-delete | None found | patient-entries/review page and API read/update using service role | None found | Billing navigation includes staff/billing_staff/practice_manager/admin/super_admin; review excludes staff; unlock only managers/admins. Provider direct access not established | Patient name, notes, date, amount, provider attribution |
| billing_detail_entries | RLS/policies/ACL not established | billing-details; BillingClient; FinancialsClient | billing-details | billing-details edit and soft-delete | None found | Afterpay upload/link/unlink/delete uses service role, including removal of linked entries | None found | Merchant-fee staff group above; Billing/Financials admin/super_admin; no provider direct need established | Optional patient name, notes, amounts |
| patient_cost_entries | Not found in searched application/library/script/migration references; live existence unknown | Unknown | Unknown | Unknown | Unknown | Unknown; do not infer unused from absent literal references | Unknown | Unresolved | Treat as sensitive until schema/dependencies verified |

### Source evidence and indirect dependencies

- Browser client: `lib/supabase/client.ts:3` uses the public key and caller session; it is not service-role.
- `app/patient-entries/page.tsx:490` reads all non-deleted entries in the selected period; provider selection is a client filter, not ownership enforcement. `:900` defines writable body fields; `:917` update; `:929` insert/select ID; `:1015` soft delete.
- `app/billing-details/page.tsx:228` reads entries; `:304` writable body fields; `:315` update; `:318` insert; `:377` soft delete. No direct hard delete found.
- `app/(protected)/billing/BillingClient.tsx:273` reads billing_period_imports; `:358` patient entries; `:377` merchant fees. Protected page requires admin/super_admin.
- `app/(protected)/financials/FinancialsClient.tsx:278`–`:286` reads providers, billing_periods, provider_monthly_records, patient_financial_entries and billing_detail_entries. Protected page requires admin/super_admin.
- `lib/imports/processImport.ts:73` onward loads/updates imports; `:103`–`:136` deletes prior totals/raw/normalized records; `:178` inserts raw; `:279` inserts normalized; `:386`, `:402`, `:443`–`:472` writes provider summaries/totals/monthly records; `:488` writes billing links.
- `app/api/imports/list/route.ts:25`, `linked-production/route.ts:38`, `[importId]/route.ts:20`, `upload/route.ts:27`, `[importId]/process/route.ts:4`: service-role routes protected by Batch 1.
- `app/api/providers/[providerId]/metrics/[importId]/route.ts:40`: service-role normalized-row read, Batch 1 billing guard.
- `app/api/praktika/production-sync/route.ts:399` onward: service-role imports/raw/normalized/billing link writes; Batch 1 entry guard plus existing current-user Praktika checks. Worker generates the upstream report, but does not directly write these billing tables in located code.
- `lib/practice-manager/get-fortnightly-staffing-kpis.ts:32` service client; `:63` billing links; `:95` normalized production. `app/(protected)/practice-manager/staff-wages-overtime-analysis/page.tsx:522`, `:554` same service-role reads. No authenticated browser grant on normalized rows is required for those pages.
- `app/api/patient-entries/review/route.ts:118`–`:150` combines profiles.role and user_roles; `:184` protects unlock; `:203` protects reviewed entries. This differs from the single-row user_roles helper. A new policy must not silently choose an incompatible role source.
- `components/ui/TopNav.tsx:111` identifies staff/billing_staff/practice_manager/admin/super_admin for patient entries and merchant fees. Navigation demonstrates intended access but is not server authorization.

## Related tables/storage

| Dependency | Current use | Policy implication |
|---|---|---|
| providers, billing_periods, material_cost_items | Browser lookup reads in patient-entries and billing-details | Preserve authorized reads; verify columns and grants before changing. Locked billing-period status is an authorization input and must not be client-writable by ordinary staff. |
| provider_monthly_records | Billing/Financials browser reads; import processor server writes | Admin financial read candidate, but inventory other consumers before narrowing globally. |
| provider_monthly_summaries, provider_item_totals | Import processing/reprocessing and deletion service-role operations | Candidate server-only; preserve processing transactions. |
| provider_period_metrics | User-scoped provider dashboard reads in lib/providers/get-provider-dashboard-metrics.ts:514 onward | Providers have legitimate aggregate reporting. Do not equate this with permission to read patient_financial_entries or raw imports. Check whether live relation is a view. |
| afterpay_imports, xero_imports | Server APIs and original-file storage access | Need live grants/RLS review too; file metadata/parsed content may be sensitive. |
| storage buckets imports, afterpay-imports, xero-imports | Service code stages/downloads files and creates signed access | Table RLS does not protect separately public storage buckets or already-issued signed URLs. Inspect bucket publicity/policies without listing objects. |
| user_roles, user_status, profiles | Role and active-state inputs | Verify client cannot change permission-bearing columns. Missing-status-row compatibility must match Batch 1 intentionally; don't use a user-visible zero-row SELECT as evidence of absence. |
| provider import raw tables / provider_import_batches | Separate provider import server actions using service role | Related security surface, not the same imports pipeline; table RLS cannot protect an unguarded service-role action. Separate review remains necessary. |

## Least-privilege proposal (not applied)

1. imports/raw/normalized: enable RLS; revoke PUBLIC/anon/authenticated table and column privileges; preserve existing necessary service-role CRUD. No browser policies needed by located source. Verify views/RPCs first because they can bypass base-table protection.
2. billing_period_imports: enable RLS; no anonymous grants; authenticated SELECT only for active admin/super_admin; no browser write policies/grants. Preserve service operations.
3. Patient entries and merchant fees: enable RLS with active authorized staff SELECT, INSERT and UPDATE policies. No authenticated hard DELETE grant. UPDATE must enforce both old-row eligibility and new-row eligibility; table/column grants must prevent forged reviewer/creator/audit fields. Preserve UI soft-delete columns. Review-lock and period-lock checks must not be bypassable by changing the locking fields in the same update.
4. No direct provider policy on patient financial/merchant-fee tables until a concrete provider workflow requiring it is established. Provider aggregate metrics remain separately scoped.
5. No policy for patient_cost_entries until its existence/schema/consumers are established.
6. No broad `USING (true)` for authenticated access. Existing permissive policies OR together: don't merely add a narrow policy next to an unknown broad one. Any targeted replacement must be based on the actual policy inventory.
7. If a narrowly scoped SECURITY DEFINER role/status predicate is required, make it non-parameterized around auth.uid(), stable, schema-qualified with a fixed search_path, no dynamic SQL, and limited EXECUTE grants. Verify protected role/status sources first. This is a proposal, not an implemented function.

## Why migration preparation is paused

The missing information is material, not cosmetic:

- Role checks differ between user_roles and profiles; integrity/read access of user_status/profiles is unknown. An invoker policy could deny legitimate users or treat RLS-hidden status rows as missing; a definer policy over client-writable status/role fields could authorize attackers.
- Patient entries have reviewed locks and billing-period locks. We do not have live column defaults, triggers, grants or policies proving which invariants PostgreSQL already protects. Granting table-wide UPDATE could allow a caller to change review/creator fields even when the UI does not.
- Unknown live permissive policies, inherited/column grants, views and callable definer functions prevent a reliable claim that anonymous paths are closed.
- patient_cost_entries has no established definition/dependency in the source.

Per Batch 2's stop-on-uncertainty requirement, obtain the preflight results before generating a deployable migration. No speculative policies are being placed in supabase/migrations.

## Production preflight

Run `scripts/security/billing-access-preflight.sql` in Supabase SQL Editor as administrator. It uses only catalog SELECTs in a read-only transaction; no patient row values, function bodies or storage objects are read. Run SELECTs individually if the UI only displays the final result. Retain outputs securely for rollback planning. Do not paste credentials or patient logs.

The script checks relation existence/owners/RLS, column types, effective table and column grants, explicit ACLs, policies, role inheritance/bypass, constraints, trigger identities, function execution grants and recursive view dependencies. Database dynamic SQL dependencies cannot be exhaustively inferred from catalog dependencies; relevant identified functions need a subsequent private source review.

Also inspect Storage configuration without opening/listing patient objects: bucket public flags and storage.objects policies. Confirm whether exposed schemas include public and any views/RPC schemas from the report.

## Verification after a reviewed migration

- Anonymous PostgREST: use the public anon key only, no user JWT. GET each protected table with `select=id&limit=0`; discard the body and record HTTP status only. With privileges revoked, expect denial (401/403), not success. This is an endpoint/grant check, not proof of row isolation when RLS legitimately permits the endpoint.
- Authorized/unauthorized: use existing authenticated sessions in a safe test environment, select only synthetic fixture IDs and return counts/booleans. An unauthorized SELECT can legitimately return HTTP 200 with zero rows under RLS; status alone cannot prove isolation. Use known synthetic fixtures for that test.
- Anonymous INSERT/UPDATE/DELETE denial: isolated PostgreSQL or a staging clone with synthetic rows only. Do not try production mutations to prove they fail.
- Inactive/wrong-role/foreign-provider tests: test SQL roles plus realistic auth.uid() claims; ensure caller cannot forge roles/is_active/review fields. Test both table and column privileges, views and relevant RPCs.
- Service role: synthetic import upload/process/reprocess/delete flow; verify raw/normalized rows, totals and links survive correctly. Verify PostgreSQL service-role operations and Batch 1 API access separately.
- Browser smoke tests: Billing/Financials load for admins; patient entries and merchant fees load/add/edit/soft-delete for permitted staff; reviewed/locked entries remain protected; signed storage links still work. Do mutations only with staging fixtures unless a real production operation is separately authorized.
- Providers: existing aggregate dashboard remains scoped to the linked provider. No cross-provider patient-row grants inferred from draft or provider identifiers.

## Deployment and rollback plan

1. Obtain live preflight and resolve role/status/lock semantics; snapshot exact policies/ACLs/owners/RLS flags and relevant function definitions privately.
2. Prepare one transactional migration with explicit grants, operation policies, and assertions. No patient backfill or data correction. Test against a representative isolated schema and synthetic data including concurrency/locked-row cases.
3. Deploy/review Batch 1 before relying on authenticated service-role endpoints. Verify production version separately; local success is not deployment evidence.
4. Apply only the reviewed Batch 2 migration during a controlled window with a short lock timeout; no index/backfill required solely for access control. Evaluate policy query performance on representative normalized volumes if browser reads are retained.
5. Run safe production read/status checks and authorized UI smoke checks. Do not automatically run live imports or patient mutations.
6. On migration error, transaction rollback leaves the original schema/grants/policies. After commit, use a reviewed compensating migration based on the captured baseline. Prefer repairing authorized-user policies while keeping anonymous access revoked; do not automatically restore public patient access or disable RLS. No data restoration is involved.

## This batch's changes and validation

Only this report and the catalog preflight SQL were added. No application, worker, schema, grant or policy changes. No migration or database access tests can honestly be reported as passed before the live policy model is known. Batch 1's 742-test/typecheck/build result remains the preceding validation; it is not a new Batch 2 database result. Whitespace validation is run on these files. RLS closure remains pending and must not be reported as deployed or complete.
