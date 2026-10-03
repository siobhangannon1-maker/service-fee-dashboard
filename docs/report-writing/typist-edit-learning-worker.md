# Typist same-request edit learning

The three Typist approval sources use newline-delimited JSON streaming. Draft
persistence, existing linked-queue handling and the existing best-effort audit
attempt finish before `approval_complete` (success and saved draft). The browser
releases loading at that event and drains the response silently. The response
then awaits the unchanged `processApprovedEdit` analyser. Its final event is
`learning_complete` or `learning_failed`, with no draft payload or UI mutation.
Provider Approval and Clinical Scribe retain JSON responses and learning-before-audit.

Selecting another letter or changing an internal Typist tab does not abort the
request. Refresh, full navigation, tab close or hosting time limits may terminate
learning. Approval has already persisted and is never reversed by learning failure.
No durable learning guarantee, background execution, worker, polling or 20-minute
worker deadline remains. Complete Workflow eligibility ignores learning.

Autosaves send their captured `expectedUpdatedAt`; the database UPDATE matches
that timestamp and status atomically. Approval advances the timestamp beyond the
previous revision even within the same millisecond. A conflict returns HTTP 409
without writing.
Approval clears its pending letter timer, waits for already-started per-draft saves,
and invalidates their selection token before installing the acknowledgement.
Behaviour reinforcement uses compare-and-swap retries on support count,
confidence and evidence summary; concurrent insert conflicts retry via the existing
(provider_id, report_type, behaviour_key) unique constraint. At 32 collisions,
learning fails explicitly rather than silently losing reinforcement.

The already-applied additive queue migration remains unchanged in migration history.
Its columns and RPCs are retained, unused by this runtime. Do not reapply it.
Read-only aggregate inspection on 3 October 2026 found zero worker-eligible rows
and zero pending/failed rows with next_attempt_at set. Repeat before deployment;
if rows appear, agree a handling plan before disabling an existing consumer.

Review locally with synthetic fixtures. Before deployment, manually verify the
stream is not buffered by hosting: approve A, select B, start Complete Workflow
for A, approve B, and verify both requests remain open during learning without
spinners or late changes to selection, tabs or workflow progress.

Final acknowledgement validation requires boolean true, an approved persisted row
with valid editor/detail fields and timestamps, and the captured provider/draft
identity. Invalid events use the existing save-error path without installing
approval state. Direct approvals complete their queue in save-draft. Image
workspace approvals send the active queue ID to update-draft, which awaits the
existing best-effort completion and queue-audit attempt before approval audit
and acknowledgement. Existing-draft approval leaves queue status unchanged.
The browser performs no approval queue POST after acknowledgement; it only
refreshes authoritative queue/draft data.
