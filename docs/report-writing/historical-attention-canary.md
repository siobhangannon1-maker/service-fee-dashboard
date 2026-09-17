# Historical attention: authenticated three-record canary

Local implementation only; deploy the reviewed route separately before using it.
No migration change is required. This procedure has NOT been executed.

Use the normal production application login as an active admin/super_admin.
Open browser Developer Tools → Console on that same application origin.
Do not copy tokens, cookies or credentials. The browser supplies its existing session.

The review is frozen: a changed record must be reviewed again, not refreshed automatically.
The endpoint accepts exactly one reviewed object per request, no batch mode.
The RPC remains responsible for transaction-level revalidation and actor authorization.
The original completion states, helper jobs and retention remain unchanged.

Paste these definitions (definitions alone do not make requests):

```js
const attentionReviews = [
  {
    "draftId": "2f442858-b565-406e-b443-9c81df082082",
    "epoch": "2026-09-13T10:31:57.223049Z/2026-09-13T10:31:57.118000Z",
    "revision": "2026-09-15T04:21:53.871+00:00",
    "fingerprint": "3be563b46a53fcff405a062da501433522efb81bcb0e589ae6751413684cadce",
    "uploadJobId": "4a411f1b-26e3-31ce-2167-3a87d6a96053",
    "artifactFingerprint": "8d3a0cf74791d025a5102d95414963e3655602cc9a18ca01bb989125192d9379",
    "manifestDigest": "e399e2d422af85cdacd9cfba0618f9742728183ba5a2e554116bb0ee6e44b8f5",
    "branches": [
      "mediref",
      "icon",
      "bookkeeping"
    ],
    "policyVersion": "historical-attention-v1",
    "reason": "historical_pdf_present_no_further_action",
    "evidenceKind": "confirmed_upload"
  },
  {
    "draftId": "6b1a65f9-9769-4f89-b6c5-cfc2bd09c4e5",
    "epoch": "2026-09-13T09:06:35.189990Z/2026-09-13T09:06:35.080000Z",
    "revision": "2026-09-15T04:07:54.128+00:00",
    "fingerprint": "290171b930f63b08876511bb35992f4602e4ed8a05069bfd7fe906a9771802ce",
    "uploadJobId": "077d9a81-d934-b3a5-3573-edd831c7a3d4",
    "artifactFingerprint": "606c45a1dd11e66fc794dea130e77d4872336041a4a4247e30b2a90c61e51855",
    "manifestDigest": "e399e2d422af85cdacd9cfba0618f9742728183ba5a2e554116bb0ee6e44b8f5",
    "branches": [
      "mediref",
      "icon",
      "bookkeeping"
    ],
    "policyVersion": "historical-attention-v1",
    "reason": "historical_pdf_present_no_further_action",
    "evidenceKind": "confirmed_upload"
  },
  {
    "draftId": "cc046477-11e6-45c1-afbc-80d3d66d4172",
    "epoch": "2026-09-13T10:04:12.681405Z/2026-09-13T10:04:12.584000Z",
    "revision": "2026-09-15T04:10:38.886+00:00",
    "fingerprint": "974c3836e4cc36ba872e16415751bd4dd9a3c369878887f8f4cceff47351b047",
    "uploadJobId": "4192c27f-e0c9-67b0-c5df-2539f757b866",
    "artifactFingerprint": "9e1c4b011af992919e7413e633cac8bed3f7390d12ddc3118405653b2066f99e",
    "manifestDigest": "e399e2d422af85cdacd9cfba0618f9742728183ba5a2e554116bb0ee6e44b8f5",
    "branches": [
      "mediref",
      "icon",
      "bookkeeping"
    ],
    "policyVersion": "historical-attention-v1",
    "reason": "historical_pdf_present_no_further_action",
    "evidenceKind": "confirmed_upload"
  }
];
async function attentionCanary(index, execute = false) {
  if (![0, 1, 2].includes(index)) throw new Error('Invalid canary index');
  const response = await fetch('/api/report-writing/historical-attention', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...attentionReviews[index], execute })
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    console.error({ status: response.status, ...result });
    throw new Error('STOP. Do not continue or automatically retry.');
  }
  console.log(result);
  return result;
}
```

First run each dry run separately, stopping on any failure:

```js
await attentionCanary(0, false) // Andrew
```
```js
await attentionCanary(1, false) // Jasper
```
```js
await attentionCanary(2, false) // Cathryn
```

All must return `eligible` or `already_dispositioned`. Then run the following
ONE AT A TIME. Wait for a positive `dispositioned`/`already_dispositioned`
acknowledgement before moving to the next record:

```js
await attentionCanary(0, true)
```
```js
await attentionCanary(1, true)
```
```js
await attentionCanary(2, true)
```

On any error, timeout or lost acknowledgement, STOP. Do not retry or proceed.
A timeout does not prove rollback; inspect only that exact disposition event
before deciding what to do next. Never update the supplied fingerprints to bypass
`state_changed`, and never impersonate an actor through SQL settings.

After all three succeed, refresh Ben Fu's Approved list ONCE (expected 129 → 126).
Confirm the three records remain in History with the non-actionable explanation,
not fabricated completion. If the count differs, stop and report.
No polling, automatic retries, external operations or background tasks are added.
