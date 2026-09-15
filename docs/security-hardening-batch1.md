# Security hardening Batch 1 — local review

No deployment, RLS/schema migration, production data change, or route deletion.

## Access decisions

- All listed browser API handlers require verified authentication and an active account before business queries or side effects. Missing/invalid sessions return 401; inactive accounts, failed status verification and disallowed roles return fixed 403 responses.
- Preserve legacy missing user_status row = active compatibility. Status lookup errors are denied; no global getUserStatus change.
- Import management and provider import metrics use admin/super_admin, matching protected Billing/import pages.
- Afterpay merchant-fee access uses the existing Billing navigation roles: staff, billing_staff, practice_manager, admin, super_admin.
- Report Writing, Xero import uploads, monthly gross production and shared billing-period lookup use active-user enforcement where finer role boundaries are not established consistently. Existing stricter checks remain in place. Review provider/draft-level permissions separately; this batch does not claim to solve all authenticated cross-user access.
- Existing signed continuation entry point is unchanged. Only upload, icon, MediRef enqueue and PDF handlers recognize its existing server-only AsyncLocalStorage context. No request header supplies that context.
- The three authorized PDF consumers invoke the same PDF handler in-process, retaining the existing cookie request context or trusted continuation context. No public PDF bypass or new bearer credential was introduced. PDF rendering now shares the caller process; review representative large-letter rendering before deployment.
- Denial logging contains only the fixed route identifier and unauthenticated/forbidden outcome; it is nonfatal. Removed shared page-auth email/phone/raw-error logs.

## Routes protected

Each path below maps to `app` + route path + `/route.ts`. All methods listed are guarded; existing additional permissions are preserved.

| Route | Methods | New entry policy |
|---|---|---|
| /api/afterpay-imports/delete | DELETE | [staff, billing_staff, practice_manager, admin, super_admin] |
| /api/afterpay-imports/link | POST | [staff, billing_staff, practice_manager, admin, super_admin] |
| /api/afterpay-imports | GET | [staff, billing_staff, practice_manager, admin, super_admin] |
| /api/afterpay-imports/unlink | POST | [staff, billing_staff, practice_manager, admin, super_admin] |
| /api/afterpay-imports/upload | POST | [staff, billing_staff, practice_manager, admin, super_admin] |
| /api/billing-periods | GET | Active user; existing checks retained |
| /api/imports/[importId]/process | POST | [admin, super_admin] |
| /api/imports/[importId] | PATCH, DELETE | [admin, super_admin] |
| /api/imports/linked-production | GET | [admin, super_admin] |
| /api/imports/list | GET | [admin, super_admin] |
| /api/imports/upload | POST | [admin, super_admin] |
| /api/monthly-gross-production | GET, POST | Active user; existing checks retained |
| /api/patient-entries/review | POST | Active user; existing checks retained |
| /api/patient-entry-creators | POST | Active user; existing checks retained |
| /api/praktika/production-sync | POST | Active user; existing checks retained |
| /api/providers/[providerId]/metrics/[importId] | GET | [admin, super_admin] |
| /api/report-writing/admin/auto-tag-provider-examples | POST | Active user; existing checks retained |
| /api/report-writing/admin/provider-examples/delete | POST | Active user; existing checks retained |
| /api/report-writing/admin/provider-examples | GET, POST | Active user; existing checks retained |
| /api/report-writing/approve-draft | POST | Active user; existing checks retained |
| /api/report-writing/audit | GET | Active user; existing checks retained |
| /api/report-writing/classify-report-type | POST | Active user; existing checks retained |
| /api/report-writing/correspondence-types | GET | Active user; existing checks retained |
| /api/report-writing/current-provider | GET | Active user; existing checks retained |
| /api/report-writing/debug-praktika-appointments | GET | Active user; existing checks retained |
| /api/report-writing/delete-draft-image | POST | Active user; existing checks retained |
| /api/report-writing/delete-draft | POST | Active user; existing checks retained |
| /api/report-writing/email-secure-pdf | POST | Active user; existing checks retained |
| /api/report-writing/generate-pdf | POST | Active user; existing checks retained |
| /api/report-writing/generate | POST | Active user; existing checks retained |
| /api/report-writing/get-audit-events | GET | Active user; existing checks retained |
| /api/report-writing/get-draft-images | GET | Active user; existing checks retained |
| /api/report-writing/get-drafts | GET | Active user; existing checks retained |
| /api/report-writing/get-history | GET | Active user; existing checks retained |
| /api/report-writing/get-providers | GET | Active user; existing checks retained |
| /api/report-writing/get-referrer-email | GET | Active user; existing checks retained |
| /api/report-writing/get-referrers | GET | Active user; existing checks retained |
| /api/report-writing/hydrate-letter-queue | POST | Active user; existing checks retained |
| /api/report-writing/letter-queue/enrich-praktika | POST | Active user; existing checks retained |
| /api/report-writing/letter-queue | GET, POST, DELETE | Active user; existing checks retained |
| /api/report-writing/letter-queue/sync-praktika | POST | Active user; existing checks retained |
| /api/report-writing/letter-queue/sync | GET, POST | Active user; existing checks retained |
| /api/report-writing/list-typists | GET | Active user; existing checks retained |
| /api/report-writing/match-praktika-patient | POST | Active user; existing checks retained |
| /api/report-writing/mediref-tools/status | GET | Active user; existing checks retained |
| /api/report-writing/praktika-clinical-notes | POST | Active user; existing checks retained |
| /api/report-writing/praktika-referrals/latest | POST | Active user; existing checks retained |
| /api/report-writing/provider-behaviours/consolidate | POST | Active user; existing checks retained |
| /api/report-writing/provider-behaviours/delete | POST | Active user; existing checks retained |
| /api/report-writing/provider-behaviours | GET | Active user; existing checks retained |
| /api/report-writing/provider-examples-for-generation | GET | Active user; existing checks retained |
| /api/report-writing/provider-knowledge/delete | POST | Active user; existing checks retained |
| /api/report-writing/provider-knowledge | GET, POST | Active user; existing checks retained |
| /api/report-writing/provider-letter-preference | GET, POST | Active user; existing checks retained |
| /api/report-writing/provider-report-type-settings | GET, POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases/analyze-provider | POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases/delete | POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases | GET, POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases/train-loop | POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases/train-provider-behaviours | POST | Active user; existing checks retained |
| /api/report-writing/provider-training-cases/train-provider-knowledge | POST | Active user; existing checks retained |
| /api/report-writing/provider-training/delete | POST | Active user; existing checks retained |
| /api/report-writing/provider-training | GET, POST | Active user; existing checks retained |
| /api/report-writing/referrers/import | POST | Active user; existing checks retained |
| /api/report-writing/referrers/search | GET | Active user; existing checks retained |
| /api/report-writing/referrers/sync-praktika | POST | Active user; existing checks retained |
| /api/report-writing/retry-mediref | GET, POST | Active user; existing checks retained |
| /api/report-writing/save-draft | POST | Active user; existing checks retained |
| /api/report-writing/send-sms-notification | POST | Active user; existing checks retained |
| /api/report-writing/send-via-mediref | POST | Active user; existing checks retained |
| /api/report-writing/smart-dictate | POST | Active user; existing checks retained |
| /api/report-writing/transcribe | POST | Active user; existing checks retained |
| /api/report-writing/universal-rules/delete | POST | Active user; existing checks retained |
| /api/report-writing/universal-rules | GET, POST | Active user; existing checks retained |
| /api/report-writing/update-draft-image | POST | Active user; existing checks retained |
| /api/report-writing/update-draft | POST | Active user; existing checks retained |
| /api/report-writing/update-praktika-letter-icons | POST | Active user; existing checks retained |
| /api/report-writing/upload-draft-image | POST | Active user; existing checks retained |
| /api/report-writing/upload-to-praktika | POST | Active user; existing checks retained |
| /api/report-writing/workflow-status | POST | Active user; existing checks retained |
| /api/xero-imports/delete | DELETE | Active user; existing checks retained |
| /api/xero-imports/link | POST | Active user; existing checks retained |
| /api/xero-imports | GET | Active user; existing checks retained |
| /api/xero-imports/unlink | POST | Active user; existing checks retained |
| /api/xero-imports/upload | POST | Active user; existing checks retained |

`/api/report-writing/transcribe-audio` re-exports the protected transcribe POST handler.

## Exact changed files

- `app/api/afterpay-imports/delete/route.ts`
- `app/api/afterpay-imports/link/route.ts`
- `app/api/afterpay-imports/route.ts`
- `app/api/afterpay-imports/unlink/route.ts`
- `app/api/afterpay-imports/upload/route.ts`
- `app/api/billing-periods/route.ts`
- `app/api/imports/[importId]/process/route.ts`
- `app/api/imports/[importId]/route.ts`
- `app/api/imports/linked-production/route.ts`
- `app/api/imports/list/route.ts`
- `app/api/imports/upload/route.ts`
- `app/api/monthly-gross-production/route.ts`
- `app/api/patient-entries/review/route.ts`
- `app/api/patient-entry-creators/route.ts`
- `app/api/praktika/production-sync/route.ts`
- `app/api/providers/[providerId]/metrics/[importId]/route.ts`
- `app/api/report-writing/admin/auto-tag-provider-examples/route.ts`
- `app/api/report-writing/admin/provider-examples/delete/route.ts`
- `app/api/report-writing/admin/provider-examples/route.ts`
- `app/api/report-writing/approve-draft/route.ts`
- `app/api/report-writing/audit/route.ts`
- `app/api/report-writing/classify-report-type/route.ts`
- `app/api/report-writing/correspondence-types/route.ts`
- `app/api/report-writing/current-provider/route.ts`
- `app/api/report-writing/debug-praktika-appointments/route.ts`
- `app/api/report-writing/delete-draft-image/route.ts`
- `app/api/report-writing/delete-draft/route.ts`
- `app/api/report-writing/email-secure-pdf/route.ts`
- `app/api/report-writing/generate-pdf/route.ts`
- `app/api/report-writing/generate/route.ts`
- `app/api/report-writing/get-audit-events/route.ts`
- `app/api/report-writing/get-draft-images/route.ts`
- `app/api/report-writing/get-drafts/route.ts`
- `app/api/report-writing/get-history/route.ts`
- `app/api/report-writing/get-providers/route.ts`
- `app/api/report-writing/get-referrer-email/route.ts`
- `app/api/report-writing/get-referrers/route.ts`
- `app/api/report-writing/hydrate-letter-queue/route.ts`
- `app/api/report-writing/letter-queue/enrich-praktika/route.ts`
- `app/api/report-writing/letter-queue/route.ts`
- `app/api/report-writing/letter-queue/sync-praktika/route.ts`
- `app/api/report-writing/letter-queue/sync/route.ts`
- `app/api/report-writing/list-typists/route.ts`
- `app/api/report-writing/match-praktika-patient/route.ts`
- `app/api/report-writing/mediref-tools/status/route.ts`
- `app/api/report-writing/praktika-clinical-notes/route.ts`
- `app/api/report-writing/praktika-referrals/latest/route.ts`
- `app/api/report-writing/provider-behaviours/consolidate/route.ts`
- `app/api/report-writing/provider-behaviours/delete/route.ts`
- `app/api/report-writing/provider-behaviours/route.ts`
- `app/api/report-writing/provider-examples-for-generation/route.ts`
- `app/api/report-writing/provider-knowledge/delete/route.ts`
- `app/api/report-writing/provider-knowledge/route.ts`
- `app/api/report-writing/provider-letter-preference/route.ts`
- `app/api/report-writing/provider-report-type-settings/route.ts`
- `app/api/report-writing/provider-training-cases/analyze-provider/route.ts`
- `app/api/report-writing/provider-training-cases/delete/route.ts`
- `app/api/report-writing/provider-training-cases/route.ts`
- `app/api/report-writing/provider-training-cases/train-loop/route.ts`
- `app/api/report-writing/provider-training-cases/train-provider-behaviours/route.ts`
- `app/api/report-writing/provider-training-cases/train-provider-knowledge/route.ts`
- `app/api/report-writing/provider-training/delete/route.ts`
- `app/api/report-writing/provider-training/route.ts`
- `app/api/report-writing/referrers/import/route.ts`
- `app/api/report-writing/referrers/search/route.ts`
- `app/api/report-writing/referrers/sync-praktika/route.ts`
- `app/api/report-writing/retry-mediref/route.ts`
- `app/api/report-writing/save-draft/route.ts`
- `app/api/report-writing/send-sms-notification/route.ts`
- `app/api/report-writing/send-via-mediref/route.ts`
- `app/api/report-writing/smart-dictate/route.ts`
- `app/api/report-writing/transcribe/route.ts`
- `app/api/report-writing/universal-rules/delete/route.ts`
- `app/api/report-writing/universal-rules/route.ts`
- `app/api/report-writing/update-draft-image/route.ts`
- `app/api/report-writing/update-draft/route.ts`
- `app/api/report-writing/update-praktika-letter-icons/route.ts`
- `app/api/report-writing/upload-draft-image/route.ts`
- `app/api/report-writing/upload-to-praktika/route.ts`
- `app/api/report-writing/workflow-status/route.ts`
- `app/api/xero-imports/delete/route.ts`
- `app/api/xero-imports/link/route.ts`
- `app/api/xero-imports/route.ts`
- `app/api/xero-imports/unlink/route.ts`
- `app/api/xero-imports/upload/route.ts`
- `lib/auth.ts`
- `lib/mediref/enqueue-preparation.test.ts`
- `lib/report-writing/history.test.ts`
- `lib/report-writing/workflow-safety.test.ts`
- `lib/api-security.test.ts`
- `docs/security-hardening-batch1.md` (this report)

## Deliberately excluded / remaining risks

- MediRef test routes remain present and require urgent containment/deletion review.
- Direct-browser Billing/PostgREST access is unchanged; the reported RLS-disabled tables still require reviewed grants/policies.
- Reception, Clinical Scribe, cron, other integration APIs, and server actions are not hardened in this batch.
- Existing authorized business-route debug/error logs and broad response projections need a separate privacy review; this batch only changes shared auth/denial logging.
- Existing modified local MediRef diagnostics and untracked files are untouched.

## Manual verification after review

Use non-patient fixtures in a safe environment. Verify logged-out/expired login yields 401 without effects, inactive yields 403, import access rejects typist, permitted Billing staff can use merchant-fee operations, and authorized Report Writing can load/save/preview. Verify signed continuation still renders PDFs and uses existing child-job protections; do not send real communications for testing. Review missing-status-row and finer role boundaries before stronger restrictions.

## Validation

- Relevant application/security suite: 742 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed (webpack production build).
- `git diff --check`: passed.
- ESLint not run: configuration exists, but ESLint / eslint-config-next are not installed dependencies. No packages added.
- No live patient or integration workflow tests performed.
