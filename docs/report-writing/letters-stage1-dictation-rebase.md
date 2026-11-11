# Stage 1 Letters portal fix on the current dictation release

Prepared 11 November 2026. Production promotion requires separate approval.

## Source identity

Current production: dpl_FhFxMsZ2DXz5bLLwx4wivFGyCCwC, serving service-fee-dashboard.vercel.app. This CLI deployment has no original Git SHA attached.

Verified production baseline commit: 233e5f7f3feeb10763151d293d517c131992d58b. All 1,095 uploaded files were reconstructed byte-for-byte against the Vercel SHA-1 manifest. One provider-page file was retrieved directly by deployment file ID and its hash verified; no source was guessed. The original .gitignore remains repository infrastructure. Detailed manifest evidence is retained locally in .vercel/production-source-baseline.json.

The release commit immediately following this baseline applies only the eight-file Stage 1 delta from 98ff785b5d58a08e7cba74c1d6e53f3f5a9d965c plus this review document. All eight patch files are byte-identical to the approved Stage 1 versions. The other 1,089 production files are unchanged. There were no merge conflicts.

## Runtime changes

- app/(protected)/report-writing/typist/TypistPage.tsx: read-only refresh when entering Letters tabs, returning focus/visibility and every 30 seconds while visible.
- lib/report-writing/typist-list-refresh.ts: no overlapping refresh within the loop; cleanup aborts requests/listeners.
- lib/report-writing/typist-approved-partition.ts: clinical approval proof controls Approved membership; current failed continuations remain operational; historical verification membership does not revert to Approved on stale enrichment.

Tests retained from Stage 1:
- lib/report-writing/letters-stabilisation.test.ts
- lib/report-writing/typist-approved-partition.test.ts
- lib/report-writing/authoritative-list-order.test.ts
- lib/report-writing/current-workflow-presentation.test.ts
- lib/report-writing/typist-card-presentation.test.ts

No Stage 2 runtime component, API route or manual-completion migration is included. No database migration is needed.

## Dictation interactions

ProviderReportClient, OpenAIDictationBox, transcribe/dictation-upload API routes and all dictation-upload client/server/contract/token helpers remain byte-identical to the live dictation deployment. Recording, signed direct uploads, retry/download retention, prompts, formatting and patient/recording ownership checks are unchanged.

The additional Typist refresh uses the existing sequence/provider/selection-guarded loader. mergeDraftWorkflow preserves editor contents and deliberately excludes the editor revision token from list refreshes. The refresh loop only runs on letter list tabs, not the Queue tab. Approval/autosave ordering, current-patient isolation and dictation editor/patient-switch protection were covered by regressions.

## Validation

- 1,371 report-writing/MediRef regression tests passed, including approval visibility, verification filtering, stale responses, autosave isolation and dictation upload/signature/context checks.
- Existing synthetic dictation route/browser harness passed in Chromium, Firefox and WebKit: 5 MB uploads, pause/resume, retained downloads, retry without re-upload, interrupted-upload recovery, editor preservation and patient-switch protections.
- Browser and route/storage/AI adapters used loopback and synthetic data only. Hosted AI/storage were not used; the real clinical/hosted-storage script was not executed.
- Standalone TypeScript: node node_modules/typescript/bin/tsc --noEmit --incremental false passed.
- Full Next.js 16.2.3 production build passed, including TypeScript. The local build used synthetic credentials and blocked production API access. Its .next output must not be deployed.
- git diff --check passed.

## Candidate deployment and approval boundary

Prepare a PREVIEW deployment on the existing service-fee-dashboard Vercel project from the clean combined release commit. Use the existing preview environment with no environment overrides. Verify every actual uploaded source hash against the commit/dry-run manifest, verify dictation file hashes against the live baseline and confirm Stage 2 files are absent. Run GET-only health/auth checks. Reconfirm that the production alias still points to dpl_FhFxMsZ2DXz5bLLwx4wivFGyCCwC.

GO for a controlled production release of this combined source after the preview is READY and verified and the user separately approves. Since production-target deployment is currently prohibited, this preview is not a staged production artifact. The later approval should cover a fresh build using the existing production environment, source/health verification and promotion of that production build. Do not deploy the synthetic local build or overwrite a newer live release without rechecking its source.

Rollback after an approved production release: restore the verified current dictation deployment dpl_FhFxMsZ2DXz5bLLwx4wivFGyCCwC. No database rollback is required. No Supabase data, migrations, Render configuration or external workflow actions are involved in this Stage 1 release.
