# Shared report draft list/detail split — local review

Status: **not approved for rollout**. No production mutations, external integration
requests, migrations, staging, commits or deployments were performed.

## Current flow and change

Previously `get-drafts` selected every report_drafts column, duplicated source_text
into clinical-notes aliases, and supplied full objects to Typist, Provider and
History. Typist selected those objects directly. Both its workflow polling paths
could replace selected detail with another list object.

The list now explicitly selects metadata in `draftListSelect` (47 columns: 46
public list columns plus the server-only historical icon-response preview). The
preview remains available to the unchanged evidence resolver and is removed from
the browser DTO. Base reads are paged in batches of 500 with stable created_at/id
ordering. Page failure rejects the list rather than returning misleading counts.

Typist and Provider selection load one full draft through `GET get-draft?id=...`.
History's existing generate-pdf request already loads the selected draft on the
server, so its PDF execution path does not change. No caller-specific full-list
mode exists.

## Field audit

The exact executable list-column inventory is `lib/report-writing/draft-contract.ts`.
It comprises identity/provider/patient name/DOB/referrer name/report type/status,
created_at/updated_at, approval/upload/email/completion/retention timestamps,
attribution initials/names, workflow states/errors/messages/progress timestamps,
Praktika patient/icon identifiers, and periodontal attachment metadata. These
support the three consumers' cards, filters, sorting, audit and workflow display.

Detail-only database fields: created_by, referrer_address, source_type,
source_text, ai_generated_text, edited_text, typist_instructions, typist_queries,
scheduled_for_cleanup_at. deleted_at filters list reads and is checked by detail
access. It is not a card field. The existing clinical_notes and
source_clinical_notes aliases are derived only in detail using the old precedence.
The historical icon response preview is server evidence, not editor/list content.

No list search uses source/AI/edited text. Provider searches patient name, referrer
name and report type. History also searches its existing patient/date/email and
workflow/error metadata. Typist's tab filters and counts use status/IDs/resolution.
No body search was removed.

## Types and authorization

`DraftListItem` has no editor-body fields. `DraftDetail` requires the body/source,
clinical-note aliases, instructions, queries and referrer address. `updated_at`
identifies the loaded database revision. New detail GET requires an active verified
user and a canonical user_roles row. Admin/super_admin/practice_manager/typist may
load an active provider's draft; a linked Provider retains access through the
existing providers.user_id relationship. Provider identity comes from the stored
draft, never a browser authorization assertion. Deleted drafts are unavailable.
All detail responses are private/no-store, with fixed errors. No privileged data
is returned on denied access. The existing list authentication is unchanged.

## History document availability

`has_final_text` is true/false/null (unknown). Two ID/updated_at-only filtered reads
preserve the exact previous `(edited_text || ai_generated_text || '').trim()`
behavior, including whitespace-only edited text suppressing an AI fallback.
[PostgREST's documented regex filter](https://docs.postgrest.org/en/v14/references/api/tables_views.html) operates inside PostgreSQL; text is not
transferred to the app. The character class explicitly matches JavaScript trim's
whitespace rather than PostgreSQL locale-dependent whitespace.

An availability read has a five-second overall deadline. Any failed page discards
its whole availability result. A revision mismatch yields unknown. It never
changes workflow resolution. Unknown availability permits an authoritative PDF
check through the existing generation route; it is not presented as confirmed
availability. This avoids hiding usable letters on an auxiliary failure.

This adds two paged metadata reads, not one query per draft. Real PostgREST
execution of the filters remains unverified because production benchmarking
stopped on the failed base query. PostgreSQL semantics passed 100 synthetic cases.

## Selection, autosave, polling

Typist advances the existing selection token and clears patient/editor/image/PDF
state before loading. Its editor is inert while detail is loading or failed;
selectedDraft is null, so no autosave starts on partial detail. Late response
checks include selection token, returned ID and provider. Queue-linked selection
uses report_draft_id directly; standalone selection clears activeQueueItemId.

Pending A saves still run against their captured A ID, in the existing per-draft
chain. Switching to B does not await/cancel them. A pending/failed local edit may
be overlaid only on A's authoritative detail. Successful saves clear that overlay,
preventing a permanent stale detail cache. Settled detail requests are removed
from the in-flight-only deduplication map. Deliberate reselection fetches again.

Workflow polls merge an explicit status/workflow whitelist, never source, edited,
AI text, referrer details, PDF settings or editor revision. Provider selection has
its own token and server provider check. Selected-letter save/approval responses
cannot reselect an old patient after selection changes; the server request still
finishes and list metadata can refresh.

There is **no existing server compare-and-swap revision check** in update-draft.
This change preserves per-draft ordering and selection isolation; it does not
claim to introduce multi-user conflict detection or silently reload unsaved work.
A newer list updated_at does not overwrite the selected editor. Explicit
reselection loads current detail (preserving an outstanding local edit).

## Queue hydration: unchanged execution

`TypistPage.loadQueue` still reads letter-queue, installs Queue cards, then calls
`hydrateQueueInBackground` without a selection requirement. The hydration request
uses limit 50. It skips cached notes/none_found and already pending/processing/
running jobs, and schedules the existing 15-second guarded Queue refresh when
jobs were enqueued. Provider tokens reject old-provider list/hydration responses.

`hydrate-letter-queue/route.ts` and `hydrateReportLetterQueueItem` in
praktika-helper-job-processor.ts are unchanged. Current matched patient IDs,
referral/provider enrichment, clinical-note matching and cached raw_json fields
remain owned by Queue. This task adds no Queue request, matching call, job,
worker concurrency change or retry. Queue hydration is not coupled to detail.
Provider changes clear old-provider cards immediately; ordinary same-provider
Queue refresh keeps its existing behavior.

No production Queue hydration was invoked for timing because its POST creates
jobs and the worker writes cached fields. Local handler tests verify that detail
loading does not gate the proactive trigger. Live first/all-card hydration
latency, job concurrency throughput and Queue payload were not measured.

## Workflows, images and PDF

Approval request contents, PDF generation/settings marker format, bulk PDF IDs,
Praktika/MediRef/continuation/retry/manual verification, icon/chart semantics and
retention evidence are unchanged. Image loading still uses the selected draft's
existing separate image component and APIs. No image binary enters the list.
Selected detail restores edited/source/AI content and PDF settings. List refresh
cannot replace detail or its image association.

## Validation

- Combined API-security/report-writing/MediRef/History suites: **1,145 passed, 0 failed**.
- TypeScript: `npx tsc --noEmit` passed.
- `git diff --check`: passed.
- Disposable PostgreSQL 17: **100/100** synthetic text-availability cases passed.
- Frozen population: 2,028; independent 1,172; adapter 1,170; additions 0;
  conservative omissions 2; real newly resolved after exclusions 1,153.
- Actual evidence-reader replay using the **new slim selected columns**: 1,170
  matches, 0 changes, 0 unavailable, 184 mocked database reads across 2,028 rows.
- New tests cover list projection/pagination, detail permissions/deletion/provider
  identity, request deduplication, late A/B/provider responses, failed detail,
  pending autosaves, settled overlay eviction, workflow merge and Queue trigger.
- No real browser end-to-end or external execution was performed. Those remain
  rollout checks, not claimed passes.
- ESLint unavailable locally; npx attempted registry access and failed DNS in the
  sandbox. No dependencies were installed and no lint pass is claimed.

## Production performance (read-only)

Project identity was verified as laolaeigxhgkotchrefj. Schema-only inspection
confirmed the selected columns. GET-only benchmark enforced an origin/table
allowlist and rejected all non-GET requests. It logged aggregate timings only.

First Benjamin Fu lightweight base query: **no rows returned**, 15-second harness
limit per attempt; installed Supabase client made four attempts, all timed out;
67,035 ms total. Max URL length 1,299 characters. No availability, historical
reader, selected detail or Queue request was reached. The first sandbox attempt
also failed transport and is not counted as production performance evidence.

Measurements for William Huynh/Lisetta Lam, p50/p95, live payload reduction,
detail latency, current Approved predictions and combined enrichment timing are
**not available**: benchmarking stopped rather than increasing production load.
The original full-payload measurements are reference figures, not new results.
No previous Approved counts are represented as current predictions.

The five-second enrichment deadline is unchanged, but headroom has not been
re-established against live data. Retention and failed evidence remain fail-closed
in local tests. The proposed provider index was neither created nor applied;
this failed HTTP measurement does not establish whether it would help.

## Release decision

**NO-GO for rollout.** First investigate the abnormal base-query/transport latency
with read-only infrastructure diagnostics, then repeat sequential live list,
availability, detail and historical-enrichment measurements. Recalculate current
Approved impact only after healthy reads. Perform synthetic local browser testing
for all three pages and proactive Queue hydration before approval.

No schema migration, new function/table/index, production workflow mutation,
external Praktika action, MediRef send, retention cleanup, central queue work,
staging, commit, push or deployment occurred.
