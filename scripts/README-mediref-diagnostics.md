# Local MediRef diagnostics

These are isolated troubleshooting tools for MediRef DOM and network changes, not production worker code. Production remote mode uses the remote draft adapter for patient name/DOB, PDFs, multiple attachments and Retry MediRef. Never import these diagnostic modules into the production worker.

## Profile and safety

The headed Chromium launcher uses `~/.docudental/mediref-dob-diagnostic-profile`. This dedicated profile retains **local MediRef authentication state**. Sign in manually; do not copy the Render profile or production session cookies. There is no Supabase connection, helper-job consumption or report-workflow database update.

Use approved test/non-sensitive data. Never commit private input JSON or paste credentials, cookies, tokens or raw captured payloads. Printed observations are sanitized structures and equality flags, not patient values or signed URLs.

A browser-context request guard blocks MediRef `sendCorrespondence` and `deleteDraft` actions, including their known route IDs, and closes the diagnostic context after an attempt. Service workers are blocked so they cannot bypass browser routing. This guards known actions, not every possible future MediRef endpoint. The tools implement no Send/delete request. The optional API-request probe below is fixed to `getUploadParameters` and does not pass through browser routing.

Manual actions in MediRef can still create/save drafts and upload PDFs. Passive capture does not mean those manual actions are read-only. Do not use real correspondence without explicit authorization.

## Invocation

Run from the repository root in an interactive terminal with dependencies and Playwright Chromium installed. Choose one mode per run and unset other diagnostic flags. Imports alone do not launch Chromium.

### Manual DOB — ACTIVE DIAGNOSTIC

```sh
MEDIREF_DOB_DIAGNOSTIC_INPUT_FILE=/absolute/private/input.json node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

The private JSON has shape `{"patient":{"firstName":"Test","lastName":"Fixture","dob":"1990-06-09"}}`. Keep it outside version control. The launcher fills the patient name; you enter DOB manually and move focus away. The observer captures sanitized events/state comparisons, not proof of committed DOB success. Name entry may trigger MediRef autosave.

### Network — PASSIVE capture

```sh
MEDIREF_NETWORK_DIAGNOSTIC=true node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

Manually enter test details and attach an approved PDF. Press Enter as prompted to finish capture. The summary correlates requests, responses and signed PUT without printing bodies or signed URLs.

### Initialization — PASSIVE capture

```sh
MEDIREF_INITIALIZATION_DIAGNOSTIC=true node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

Reload a blank Compose page, then manually enter name/DOB. Captures Compose data and the first save request for structural comparison, with a two-minute bound.

### Upload key — PASSIVE capture

```sh
MEDIREF_UPLOAD_KEY_DIAGNOSTIC=true node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

Reload Compose, enter test details and attach one safe PDF. Captures through the first save after signed PUT, bounded to three minutes. Outputs sanitized key analysis and file metadata structure.

### Upload source — PASSIVE capture; optional ACTIVE DIAGNOSTIC probe

```sh
MEDIREF_UPLOAD_SOURCE_DIAGNOSTIC=true node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

Adds comparison with observed JSON/bootstrap sources. At the optional prompt, pressing Enter skips the active probe. Typing `VERIFY` requests a second fresh Compose draft in the same tab, then performs **one upload-parameter request**. The probe itself does not upload a PDF, save, send or delete. Manual name entry used to establish that draft may autosave. Raw prefixes remain private in memory.

### Prefix comparison — PASSIVE capture

```sh
MEDIREF_PREFIX_COMPARISON_DIAGNOSTIC=true node --import tsx scripts/mediref-dob-diagnostic-local.ts
```

Manually attach safe PDFs in two fresh Compose drafts in the same tab. Compares observed prefixes privately with the historical constants read from the two local test-route source files; those routes are not imported or executed. Prints only match/stability flags and suffix classification. No live prefix is persisted by the diagnostic. A later run can reuse the dedicated local profile without persisting the captured prefix.

`MEDIREF_DIAGNOSTIC_TEST_PDF=/absolute/path/test.pdf` optionally checks that a named PDF file exists for network modes other than initialization. It does not attach that file automatically. Network modes do not require the private DOB JSON.

Close through the terminal prompts. No production job is completed by these tools.

### Persistence — PASSIVE save observation plus TWO ACTIVE same-draft GETs

Run only when explicitly authorized, using the existing isolated local profile:

```sh
MEDIREF_PERSISTENCE_DIAGNOSTIC=true npx tsx scripts/mediref-dob-diagnostic-local.ts
```

Use this mode alone. No private input JSON is needed; all details and the PDF are
entered manually. It does not import the production adapter or access Supabase,
Render, helper jobs or production cookies. Loading the modules is inert. The local
Send/delete guard is installed before navigation and service workers are blocked.
The diagnostic performs no save, upload, Send or deletion itself. Manual field entry
and attachment upload DO save a real test draft in MediRef; do not use existing
patient correspondence or interfere with a shared staff session.

1. Sign in/MFA manually in the isolated browser.
2. Open ONE fresh blank Compose draft in the selected tab. Follow the terminal
   prompts and press Enter to begin capture BEFORE entering fields or uploading.
3. Enter a synthetic name and DOB, attach ONE safe test PDF, wait until the file is
   visibly present, and move focus outside the upload control. Do not click Send.
4. Press Enter. The tool reads the same draft through `BrowserContext.request.get`,
   without navigating/reloading the page. It observes another 12 seconds, then
   performs a second GET. Keep the same draft open; ordinary focus activity can be
   observed. Do not submit, Send or navigate.
5. Review the structural summary. Press Enter to close. The test draft is NOT
   deleted by the tool.

Capture has a five-minute lifetime; restart the diagnostic if it expires. Each GET
has a five-second request timeout and a 5.5-second overall inspection deadline;
redirects are disabled and JSON above 256 KiB is rejected. Playwright buffers API
responses before inspection, so this is a parsing/output bound, not a guaranteed
network-memory bound. The GETs use the isolated browser's authenticated session;
remote access logs/session activity may change. Repository inspection cannot prove
that a remote loader has zero side effects.

The draft identity is captured from an exact trusted `/compose/{id}` URL and the
page must still identify that draft at each read. Expected file identity comes
from a captured upload-parameters key and a same-draft browser save containing
exactly that one file. Those values stay private. Matching requires the exact key; when both records expose upload ID it must also
agree. Persisted records may expose only key and basic metadata, as in the verified
live capture. Malformed or contradictory identity fields fail closed. Filenames/counts alone never match.

Supported page data has `type: "data"` with indexed-value data nodes. Null/skip
nodes, special primitive references, null-prototype record tags and opaque Date
metadata are supported. Date payloads are never instantiated or used as identity. The
parser searches decoded data for exactly one object with the matching `s3uuid`
and a `files` array. Unsupported tags, malformed references, cycles, missing identity, multiple
candidates, invalid data or absent expected identity are INCONCLUSIVE. This is a
conservative candidate contract, not a claim that current live MediRef uses it.
Do not loosen it based on synthetic tests alone.

Only status, allowlisted content-type classification, identity-presence booleans,
file counts and allowlisted field types are emitted. No patient name/DOB, filename,
keys, upload IDs, signed URLs, cookie values or raw bodies/errors are printed.
Later saves report whether `files` exists, its count, and private identity equality.
The observer records requests, not proof those later saves were accepted. Saves
seen during the initial read are counted separately. Excess events invalidate the
observation rather than silently supporting a conclusion.

Interpretation:
- A: matching attachment at both reads; not proof against a later overwrite.
- B: initially present, subsequently absent, with an intervening changed/omitted
  files save; correlation only, not proof the save caused the loss.
- C: attachment absent at both supported reads despite the user's visible-success
  confirmation; inspect contract/loader semantics before concluding data loss.
- D: insufficient/unsupported evidence. No production acceptance decision follows.

This manual-upload experiment cannot by itself reproduce an API-written-state
race. It establishes what the manual browser path exposes and observes later
browser saves; a separate controlled experiment would be needed for causal proof.

Local fixtures only:

```sh
npx tsx --test scripts/mediref-persistence-diagnostic.test.ts scripts/mediref-network-diagnostic.test.ts scripts/mediref-dob-diagnostic.test.ts scripts/mediref-dob-diagnostic-local.test.ts
```

### Persistence transport classification

Each read now includes a value-free `transport` summary even when decoding fails:
top-level type, array/object counts, bounded observed depth, truncation flag,
allowlisted node/tag counts, allowlisted field counts, unknown-field count, transport
marker booleans and reference validity/reuse counts. Unknown node/tag/field names
are never emitted. Numeric response values and actual reference indices are not
printed. Standard transport markers are fixed enum labels, not arbitrary values.

Reasons distinguish `unknown_tag`, `malformed_tag`, `invalid_reference`,
`cyclic_reference`, `unsupported_node` and `bounds_exceeded`. Unknown/custom tags
remain inconclusive: no eval, payload-selected constructors or custom revivers run.
Repeated references are supported; cycles deliberately fail closed. Special values
follow devalue's constants; holes cannot supply a file identity.

These additions are based on the upstream transport definition, NOT a captured
live MediRef body. The earlier flags establish a decoder failure but cannot tell
which node/tag caused it or whether MediRef changed versions. Tests for skip nodes,
Date metadata and null-prototype records are synthetic standard-transport fixtures.
The next authorized manual run should supply only the sanitized report, never the
raw page-data body. A supported parse still requires the exact draft and privately
matched expected key/upload ID before reporting attachment presence.

Protocol references: [devalue parser](https://github.com/sveltejs/devalue/blob/main/src/parse.js),
[devalue constants](https://github.com/sveltejs/devalue/blob/main/src/constants.js),
[SvelteKit client](https://github.com/sveltejs/kit/blob/main/packages/kit/src/runtime/client/client.js).
No dependency or production transport implementation was changed.

### Shared production acceptance parser

`lib/mediref/persisted-draft.ts` now owns the pure restricted page-data decoder and
private one-to-one file identity matching. This local diagnostic reuses it; the
production adapter never imports a diagnostic script or structural classifier.

The remote adapter retains patient-save, upload-parameters, PUT and final-save
ordering. It then polls only the same-draft data GET for at most ten seconds,
pausing 500 ms between unsuccessful reads (each request at most five seconds).
`attachment_saved` means save-request acceptance; only
`attachment_persistence_verified` establishes read-back acceptance before success.
Unverified persistence raises a safe stage error. Upload/save are not replayed;
existing staged PDFs remain available for reconciliation and manual Retry.
No speculative Compose autosave coordination is included.
