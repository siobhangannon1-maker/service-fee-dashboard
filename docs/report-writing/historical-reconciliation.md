# Historical workflow reconciliation infrastructure

Status: LOCAL implementation; not applied, deployed, or executed in production.

## Authority and scope

One immutable `system_historical_reconciliation` event in
`report_writing_audit_events` records four branch outcomes. Original jobs, requests,
responses, actors, errors, attempts, timestamps and draft contents are not rewritten.
The RPC never creates jobs or invokes an integration. Reconciliation does not send,
retry, resume a continuation or delete text.

`inspect_historical_workflow(uuid)` is a service-only, SELECT-only offline verifier.
It implements the frozen historical association contract, returns branch references
and a SHA-256 digest of the complete relevant database snapshot, and never returns
raw letters/job bodies. This is intentionally NOT a runtime list endpoint.

`reconcile_historical_workflow(uuid, text, text, boolean default true)` takes draft
ID, expected snapshot fingerprint, execution version and dry-run flag. It locks,
revalidates and returns eligible/reconciled/already_reconciled, or a fixed rejection.
Only an explicit false dry-run value inserts an event. A changed snapshot rejects.

## Identity

UUIDv5 namespace `66d895a8-f955-5e36-a98c-62791e7d92bf`, name:
`draftId:epoch:workflow`. Epoch is UTC creation timestamp plus approval timestamp,
with six fractional digits (or `unrecorded` approval). Cleanup/contract version is
not part of identity. A unique partial index also enforces entity + epoch + action.
An invalidation UUID is UUIDv5(original reconciliation ID, `invalidated`).

## Privileges and immutability

Migration requires postgres audit-table ownership, RLS on, and service CRUD.
It revokes client/PUBLIC INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
and all corresponding column write grants; checks effective client privileges;
and revokes service-role audit TRUNCATE. Existing SELECT/RLS and ordinary service
INSERT/UPDATE/DELETE remain unchanged.

All helper functions have empty search_path and fully qualified object references.
PUBLIC/anon/authenticated execution is revoked. Only inspection, reconciliation and explicit retention-release
RPCs grant service_role EXECUTE. Definer functions are owned by the migration owner,
which must be postgres. No browser actor or role is accepted as authority.

A reserved-event trigger validates structure, rejects direct service-role insertion,
and rejects UPDATE/DELETE of reserved events regardless of ordinary application role.
The definer RPC is the insertion authority. TRUNCATE is blocked on the audit table;
source-table TRUNCATE is blocked once authoritative evidence exists. A database owner
can still perform deliberately approved emergency DDL recovery; this is not an
ordinary application path.

## Concurrency and supersession

Existing reservation/retry/manual-verification RPCs lock the draft, but legacy
Praktika and MediRef helper insertions do not. Database triggers therefore acquire
shared transaction advisory fences on relevant draft/job/audit/appointment keys.
The reconciliation RPC takes exclusive TRY fences, plus NOWAIT draft row lock.
Busy state rejects; there are no explicit broad table locks. Normal writers share
fences and are not serialized with each other by these advisory locks.

RPC re-inspects after acquiring every evidence fence. The snapshot includes parents,
all candidate uploads, relevant icon jobs, MediRef jobs, upload audits, other draft
audits and duplicate icon metadata. Audit links also fence their referenced jobs.

If a later relevant write occurs after reconciliation, its same transaction inserts
one immutable `system_historical_reconciliation_invalidated` event. It does not edit
or delete the original completion event. It advances the affected draft's updated_at
so existing compare-and-swap consumers do not use the old revision. The resolver
rejects invalidated evidence and modern attempts take precedence. Ordinary metadata
edits on unrelated drafts do not invalidate an event merely because an appointment
ID is shared; actual icon/appointment evidence changes remain conservative.

Normal retention clearing, with the corresponding deletion markers, is exempt from
invalidation. An ordinary retention audit INSERT is exempt only if its exact action,
actor, six-field details contract, unique allowed deleted-field list, typed thresholds,
historical completion time and actual null fields/deletion markers validate against
the same released, uninvalidated reconciliation. Audit UPDATE/DELETE and malformed
lookalikes remain fenced. Ordinary client INSERT remains denied. Retention thresholds and authentication are unchanged. No cleanup is
called by reconciliation. Concurrent writes are ordered: a writer that wins the
fence is seen/rejected by reconciliation; a writer after reconciliation atomically
supersedes it before its job becomes visible/dispatchable. A later write is not
silently authorized by this infrastructure; existing eligibility guards still apply.

## Runtime

`projectWorkflowRecovery` keeps modern linkage, retry and manual verification reads.
It no longer calls `readHistoricalWorkflowEvidence` or searches artifact paths,
historical upload audits, appointment jobs or duplicate historical icon metadata.
It reads only reserved completion/invalidation/retention-release events for requested draft IDs,
in batches of 100 under the existing shared five-second deadline. Failed batches
remain unresolved; event details do not go to browser list payloads.

`historical-workflow-offline.ts` and the pure historical utilities are controlled
engineering tools only. The local list/detail implementation and Queue hydration
are preserved. This infrastructure adds no prospective patient-name filtering.

## Offline tool

`node --import tsx scripts/historical-workflow-cleanup.ts` requires explicit
`--env-file`, `--project-ref`, `--output`. No environment is loaded implicitly.
Modes: `manifest`, `dry-run` (default), `retention-impact`, `execute`.
Manifest generation also requires `--execution-version`; other modes require
`--manifest`. Outputs are private and never contain letter bodies or patient names.

Execution additionally requires BOTH `--execute-system-reconciliation` and the exact
`--approved-manifest-sha256`. These switches are safeguards, NOT production approval.
It uses only the reconciliation RPC, never external jobs. Operations are sequential,
not retried automatically, and execution results are journaled. Re-run idempotency
is enforced by the RPC. Manifest files are exclusively created, not overwritten.

The RPC must first exist in the target database. Before production migration,
private frozen structural fixtures can be checked in disposable PostgreSQL instead.
An old manifest made before this RPC does not contain the new authoritative snapshot
tokens and MUST NOT be used directly for execution.

## Retention impact

The event's reconciledAt is the system audit timestamp, NEVER completion time.
Historical completion uses the existing maximum of trustworthy terminal branch
timestamps. Missing/future/untrustworthy time produces null and denies retention.
The event alone does not delete any data. Durable historical completion now carries
an explicit retention hold until an authoritative release event exists. Other completed
workflows retain their normal retention behavior. Existing authenticated retention
execution and age rules remain mandatory. Source/AI/final text is never reread by the
durable resolver to retain completion; the creation-time fingerprint remains an immutable
snapshot commitment, not a requirement that subsequently retained text still exists.

The read-only impact tool reports original completion, age, presence-based eligibility
and existing deletion markers without downloading clinical text. Its reported defaults
are source 30 days, AI 30 days, final 90 days, final deletion OFF. Confirm production
configuration separately; do not treat local defaults as production configuration.

## Production rollout gates — not authorized yet

1. Review exact migration, writer fences, immutable-event protections and tests.
2. Verify production owner/grants/RLS, extension availability and migration order.
   Capture baseline/backup; apply the migration only after explicit approval.
   Index/trigger DDL can briefly acquire locks; lock_timeout is three seconds.
3. Deploy runtime separation + bounded event support only after explicit approval.
   Historical records remain in Approved until genuinely reconciled.
4. Generate fresh manifest using installed read-only inspection RPC. Compare exact
   candidate IDs to the approved cohort; no hardcoded count authorizes execution.
5. Review dry run, state changes and retention impact. Confirm configured thresholds
   and assess what an independently scheduled retention job could do afterward. The
   historical-only hold must be deployed before any reconciliation execution.
6. Obtain SEPARATE explicit approval for the exact manifest digest and execution batch.
7. Execute controlled batches, stop on unexpected results, revalidate every record.
8. Verify runtime/History/Approved read-only. Do not retry uncertain jobs.
9. Obtain SEPARATE explicit approval before releasing retention holds. Release only
   the reviewed reconciliation IDs; never release by patient name or a broad date range.

No automatic rollback deletes audit evidence or restores broad client privileges.
Before any reconciliation, migration transaction rollback can leave the schema unchanged.
After events exist, prefer a forward correction and retain immutable evidence/fences;
any emergency schema rollback needs a separately reviewed plan and baseline.
Manual historical reconciliation, icon policy changes, practice-wide execution and
watchdogs remain out of scope.

## Local validation — 16 September 2026

- Application/security/report-writing/MediRef/History suite: 1,172 passed, zero failed.
- TypeScript `npx tsc --noEmit`: passed. `git diff --check`: passed.
- Disposable PostgreSQL 17: 34 passed; migration/privilege/immutability/rollback/concurrency
  tests, including ordinary service audit logging and actual reservation/retry/manual
  verification RPC lock races. Populated EXPLAIN ANALYZE uses both new indexes with
  5,000 synthetic reconciliation events; this is not a production latency claim.
- Frozen SQL evidence contract: 1,153 expected, 1,153 accepted, zero additions,
  zero omissions. This is isolated fixture replay, not a production RPC execution.
- Existing Queue tests cover automatic hydration before detail selection, old-provider
  response isolation, and hydrated-card refresh. No Queue behavior was changed.

Final production SELECT-only list sample (one sample per provider; no meaningful p95):

| Provider | Drafts | Client list bytes | Base list | Availability | Recovery including reconciliation | Reconciliation lookup span | Total | Requests excluding detail |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Benjamin Fu | 434 | 805,352 | 0.575s | 0.454s | 2.337s | 0.426s / 5 calls | 3.372s | 27 |
| William Huynh | 524 | 990,615 | 1.221s | 0.584s | 1.770s | 0.303s / 6 calls | 3.580s | 34 |
| Lisetta Lam | 77 | 138,115 | 0.312s | 0.358s | 0.501s | 0.173s / 1 call | 1.173s | 8 |

No deadline failures, unavailable evidence, or historical reconstruction queries.
The reconciliation lookups return zero rows before migration/cleanup. Populated
production timings therefore remain a rollout verification item. Heap deltas were
GC-sensitive and are not reliable memory measurements. Detail was tested separately.

Read-only retention impact for the current 1,153-record cohort: zero changed draft
revisions; source eligible 636, AI eligible 638, final eligible zero. Existing deletion
markers: zero. Defaults assumed: 30/30/90 days, final deletion OFF (zero eligible even
if enabled). The private per-record report contains historical completion time, age,
eligibility and markers without text bodies. Production configuration was not inspected.
This impact must be reviewed before executing reconciliation, because a separately
scheduled retention run may subsequently act on newly resolved records.

## Immutable retention release — implemented locally, NOT executed in production

`release_historical_retention(p_draft_id uuid, p_reconciliation_id uuid,
p_review_reference text, p_release boolean DEFAULT false)` is service-only, uses
empty search_path, and returns a dry-run eligibility result by default. An explicit
true inserts one `system_historical_retention_released` event, never edits completion.
Identity: UUIDv5(reconciliation event ID, `retention-released`). The existing unique
entity/epoch/action index now includes this third reserved action. Release events
share reserved-event insertion and immutable UPDATE/DELETE/TRUNCATE protections.

Release records reconciliation ID, epoch, fixed source/contract/reason, a constrained
review-reference identifier and releasedAt. It claims a controlled system release,
not a fabricated human verification of external delivery. Duplicate calls return the
same release; conflicting identity rejects. Missing/invalidated/deleted/changed-epoch
completion or untrustworthy historical time rejects. All original evidence resource
fences are acquired so release cannot race past an in-flight new attempt. Subsequent
activity still invalidates reconciliation; the old release cannot authorize a new epoch.

Normal runtime fetches release events in the same bounded indexed query. Only a valid
release for the exact completion/epoch sets historicalRetention.released=true. Missing,
malformed, duplicate, future or wrong-epoch releases leave the hold in place. Retention
then uses original historicalCompletedAt, never reconciledAt or releasedAt. No new
environment switch, table, column or mutable flag was introduced. No release mode
was added to the offline cleanup tool; release requires separately approved RPC use.

Confirmed production policy (owner): source 30 days, AI 30 days, final 90 days, final
deletion OFF, daily retention enabled. No policy or scheduler change was made. The
636 source/638 AI potential deletions remain held until a separately reviewed release.
No production reconciliation or retention release has been executed.

## Corrected pre-migration review

The previously reproduced retention-audit invalidation blocker is corrected locally.
The complete synthetic sequence now proves held -> explicit release -> historical-age
retention -> source/AI deletion markers -> exact ordinary audit -> still completed and
absent from Approved. Normal retention policy and route authorization are unchanged.
Initial SQL variable ambiguity was corrected; final tests have no failures.

The unapplied migration now adds nine functions (the original seven plus the narrow
audit validator and release RPC), two indexes and nine triggers. Existing tables and
columns are unchanged. Rollback before any reserved events must also remove the two
new functions and revoke their grants; release events join the zero-event rollback guard.
After any completion/invalidation/release event, preserve immutable evidence and use
a separately reviewed forward correction. No automatic rollback is provided.

Final production SELECT-only baseline: migration absent, zero completion/invalidation/
release events, no reserved functions/triggers, postgres ownership, RLS on/FORCE off,
unchanged audit ACL baseline/no column grants/no policies, service CRUD preserved,
no active reconciliation SQL observed. Fresh cohort: 1,153 eligible with zero changed
snapshots; 260 manual (193 MediRef), 386 engineering, one unfinished remain excluded.
The SQL frozen replay also matches all 1,153 with zero additions/omissions.

READY TO APPLY MIGRATION: YES, subject to explicit production application approval.
This does not approve runtime deployment, historical execution, retention-hold release
or invoking cleanup. Runtime hold support must be deployed BEFORE historical execution.
Then: fresh manifest -> dry run -> retention impact -> review -> reconciliation approval
-> execution -> Approved/History verification -> separate retention-release approval.
