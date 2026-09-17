# Frozen positive-PDF attention execution

Prepared locally; NOT deployed or executed by this change.

Approved cohort: 61 records (59 confirmed deterministic remediations, two other
confirmed uploads). No manual-upload entries are executable in this cohort.

SHA-256 of the exact compact JSON bytes:
`caeb542145f38be0deb380c115745bde5e6ab394434933f5282288e851ade5af`

Private original: `/private/tmp/final-attention-review-20260917/FINAL-FROZEN-positive-pdf-cohort.json`.
The deployment-owned copy is `lib/report-writing/historical-attention-cohort.json`.
No names, clinical content, PDF contents or credentials are included in that copy.

The server verifies its compiled artifact against the pinned SHA-256. Each POST
must supply that digest and match every frozen entry field exactly. The cohort
is authorization scope, not success evidence. The authenticated RPC calls its
inspector under transactional locks and recomputes the evidence fingerprint.
No SQL actor substitution, service-role disposition or new migration is used.
The original three canary snapshots remain accepted for idempotent requests.

The missing draft `4bd19e77-e6f8-4f40-bc50-4068b052da56` is excluded: the targeted
production read returned no row, which meets the inspector's NOT FOUND guard.
The historical eligibility guard is unchanged. This review does not establish
why the draft disappeared after discovery.

Unknown (348), ambiguous (89), legacy association review (21), current/active
(13), new/changed (13), and manual-evidence review (3) remain outside this cohort.
These are retained discovery counts, not a new production recount.
The RPC already supports `operator_attestation` + explicit confirmation, which
can truthfully record manually ensured PDF presence. That requires a separately
reviewed frozen manual cohort; it is not interchangeable with confirmed upload.

## Operator procedure after separately approved deployment

1. Log into the production application normally as an active admin/super_admin.
2. From the repository Terminal, copy the complete controller:

   ```sh
   pbcopy < scripts/historical-attention-browser-controller.js
   ```

3. Open Developer Tools → Console on the logged-in application. Paste and execute
   once. This is the single explicit execution command; it will mutate attention
   audit events. It performs no external operations.

The controller loads and independently hashes the server's exact cohort, then
runs at most ten records per batch, strictly sequentially. Every record first
uses the authenticated dry-run RPC path. Only positive eligibility permits the
mutation request. Positive disposition acknowledgement is required before the
next record. `already_dispositioned` is idempotent success.

A Web Lock prevents overlapping tabs; a durable browser journal prevents blindly
restarting an interrupted run. Journal key:
`historical-attention:caeb542145f38be0deb380c115745bde5e6ab394434933f5282288e851ade5af`.
Inspect it without making a request:

```js
JSON.parse(localStorage.getItem('historical-attention:caeb542145f38be0deb380c115745bde5e6ab394434933f5282288e851ade5af'))
```

Any rejection, changed evidence, timeout or lost acknowledgement stops the entire
controller. Do not clear its journal or automatically retry; first review the
exact affected audit event. A timeout does not prove rollback. The journal stores
IDs, batch/stage/results and digest, never credentials or patient content.

Expected successful total: dispositioned + already_dispositioned = 61.
Only after full success perform the separately authorized single bounded
Approved recalculation. A reduction of 61 assumes no intervening user activity;
no final production count is claimed by these local changes.

No polling, cron, workers, per-card calls, upload, send, icon operation,
continuation, completion mutation or retention release is introduced.
