import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processorSource = readFileSync(
  new URL("../../scripts/praktika-helper-job-processor.ts", import.meta.url),
  "utf8",
);

const refreshSource = readFileSync(
  new URL("../../scripts/refresh-praktika-session.ts", import.meta.url),
  "utf8",
);

test("production helper supplies a strict write-authentication fence", () => {
  assert.match(
    refreshSource,
    /async function ensureWriteAuthenticated\(\)/,
    "production helper must define the write-authentication fence",
  );

  assert.match(
    refreshSource,
    /probePraktikaAuthentication\(\s*ownedContext,\s*practiceId,\s*PRAKTIKA_BASE_URL\s*\)/,
    "write fence must use the existing same-context Praktika authentication probe",
  );

  assert.match(
    refreshSource,
    /result\.verified && result\.httpStatus === 200/,
    "only a positively verified 200 may authorize a write",
  );

  assert.match(
    refreshSource,
    /result\.httpStatus === 307 && result\.redirectDiagnostics\?\.refreshTransition === true/,
    "307 may only enter the bounded refresh-transition path",
  );

  assert.match(
    refreshSource,
    /WRITE_AUTH_REFRESH_RETRIES = 2/,
    "refresh-transition retries must remain explicitly bounded",
  );

  assert.match(
    refreshSource,
    /ensureWriteAuthenticated:/,
    "the real helper must pass the write-authentication fence to the worker",
  );
});

test("worker authenticates before declaring an external write started", () => {
  const beforeRequestStart = processorSource.indexOf(
    "const beforeRequest = async () =>",
  );
  assert.notEqual(beforeRequestStart, -1);

  const beforeRequestEnd = processorSource.indexOf(
    "    };",
    beforeRequestStart,
  );
  assert.notEqual(beforeRequestEnd, -1);

  const beforeRequestSource = processorSource.slice(
    beforeRequestStart,
    beforeRequestEnd + 6,
  );

  const callbackIndex = beforeRequestSource.indexOf(
    "await ownership.ensureWriteAuthenticated();",
  );
  const externalStartedIndex = beforeRequestSource.indexOf(
    "externalStarted = true;",
  );

  assert.notEqual(
    callbackIndex,
    -1,
    "worker must invoke the optional production write-authentication fence",
  );
  assert.notEqual(
    externalStartedIndex,
    -1,
    "worker must still retain its external-write replay boundary",
  );
  assert.ok(
    callbackIndex < externalStartedIndex,
    "authentication must finish before externalStarted becomes true",
  );

  assert.match(
    beforeRequestSource,
    /if \(!retrieval && ownership\.ensureWriteAuthenticated\)/,
    "read/retrieval operations must not acquire the write-only authentication fence",
  );

  assert.match(
    beforeRequestSource,
    /await ownership\.assertOwned\(\)/,
    "ownership must be rechecked around the write-authentication boundary",
  );
});

test("multipart request invocation occurs after the pre-dispatch fence and redirects remain disabled", () => {
  const multipartStart = processorSource.indexOf(
    "async function runMultipartStorageRequest",
  );
  const multipartEnd = processorSource.indexOf(
    "async function runPraktikaRequest",
    multipartStart,
  );

  assert.ok(multipartStart >= 0);
  assert.ok(multipartEnd > multipartStart);

  const multipartSource = processorSource.slice(multipartStart, multipartEnd);

  const beforeRequestIndex = multipartSource.indexOf(
    "await beforeRequest?.();",
  );
  const requestInvokedIndex = multipartSource.indexOf(
    "upload.requestInvoked = true",
  );
  const postIndex = multipartSource.indexOf(
    "context.request.post(",
  );

  assert.ok(
    beforeRequestIndex >= 0,
    "multipart upload must pass through the pre-dispatch fence",
  );
  assert.ok(
    requestInvokedIndex > beforeRequestIndex,
    "requestInvoked must remain false until the pre-dispatch fence has completed",
  );
  assert.ok(
    postIndex > requestInvokedIndex,
    "the external POST must occur only after requestInvoked is recorded",
  );

  assert.match(
    multipartSource,
    /maxRedirects:\s*0/,
    "multipart writes must never automatically follow/replay redirects",
  );
});
