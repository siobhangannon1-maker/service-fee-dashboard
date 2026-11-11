# Letters workflow enrichment correction

Isolated branch: fix/letters-enrichment-audit-discovery. Base: bf1e0be77e913a6cb971e192ec8c6b54e785b633. Not committed or deployed.

## Confirmed evidence

The custom production domain app.focusdentalspecialists.com.au and service-fee-dashboard.vercel.app both resolve to dpl_9PWW5Ka7VtfJrJPY7jRJ9W7dYTeB. Public login bundle hashes on the Vercel domain match the deployment-specific URL. Localhost runs the original working directory, whose workflow projection differs from that deployment. Both use Supabase project laolaeigxhgkotchrefj. No relevant environment variable selects a different portal filter.

Read-only replay of the existing server projection and client partition against the affected provider's complete 145-row metadata list reproduced the screenshot counts: deployed source 73 Approved / 27 Requires Verification; localhost 33 / 0. No authenticated browser API response was available; this is a direct execution of the checked-in read path, not a captured Vercel invocation.

The audit lookup requests all resolutionActions, including 4,286 execution and 4,273 settlement journal entries for this provider. Their paginated download exhausts the shared five-second evidence deadline before parent/child reads can establish current status. There were no HTTP permission errors in the read-only reproduction. Failed reads set workflowStatusStale and unavailableWorkflow; this yields the stale warning and needs-attention cards. Loss of authoritative completion evidence reintroduces 40 letters into Approved and routes 27 older letters to Verification. The raw record list is unchanged.

With the narrow query correction, all 145 records classify identically to localhost: 19 not-started letters and 14 unresolved letters remain Approved; 88 have evidence-backed completed workflow projections; 24 are draft/edited-by-typist. All 121 approved/uploaded records have clinical approval timestamps. Zero Awaiting Approval is supported by the database. The two read-only patched checks had no failed enrichment requests. The most recent sampled approval remains Approved in both sources, but deployed enrichment labels it uncertain rather than ready. A separate missing-record defect was not reproduced.

## Minimal patch and safeguards

workflow-recovery.ts requests only verification, resume and completed resolution events for discovery, matching the existing resolutionIds condition. Execution/settlement/branch-fence events were never discovery triggers. The existing workflow_resolution_projection RPC still reads its full authoritative fingerprint and execution-safety evidence for discovered resolutions. Historical invalidations, manual verification and retention evidence are unchanged.

No approval writes, clinical decisions, retry logic, helper execution, auth, timeout, portal filter, dictation code or schema changes. Real failed/partial enrichment remains uncertain; the patch never replaces unknown state with ready or completed. No Stage 2 path or migration is introduced.

## Validation

Eight new synthetic tests cover the 73/27 versus 33/0 scenario, timeout uncertainty, each of the three resolution triggers, execution safety and historical invalidation. Full Letters/MediRef/dictation regression suite: 1,379 passed, zero failed. Standalone TypeScript and production build results are recorded in the final review report. Production build uses synthetic configuration with production API access blocked; never deploy its local .next output.

## Release and rollback

After separate approval, checkpoint this patch, recheck the current production revision, and stage a fresh production-environment Vercel build without assigning domains. Verify source hashes, dictation preservation, absence of Stage 2 and HTTP health before promotion. The owner should then check the affected provider's Approved/Verification tabs after reload. Counts can change as legitimate work continues; the key check is evidence-backed classifications without stale warnings.

Rollback target: dpl_9PWW5Ka7VtfJrJPY7jRJ9W7dYTeB. No database or Render rollback is required. Do not retry jobs or run Complete Workflow as a test. The number of audit events can grow elsewhere too; this correction avoids irrelevant journal downloads without weakening the bounded reader. Independent RPC latency or failed evidence reads still deliberately remain uncertain.
