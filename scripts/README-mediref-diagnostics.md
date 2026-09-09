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
