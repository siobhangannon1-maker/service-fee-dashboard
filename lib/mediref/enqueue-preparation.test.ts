import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createEnqueueDiagnostics } from "./enqueue-transition";

const source = readFileSync("app/api/report-writing/send-via-mediref/route.ts", "utf8");
// Execute the actual route's isolated preparation functions with local I/O doubles.
const functions = source.slice(source.indexOf("async function stagePdf("), source.indexOf("export async function POST"));
const javascript = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const failure of ["pdf_generation", "pdf_validation", "storage_upload", "storage_verification", "stored_undersized", "success"] as const) {
  test(`route preparation boundary: ${failure}`, async () => {
    const diagnostics = createEnqueueDiagnostics();
    let uploaded = 0; let downloaded = 0;
    const storage = { from: () => ({
      upload: async () => { uploaded++; return { error: failure === "storage_upload" ? { message: "SECRET" } : null }; },
      download: async () => { downloaded++; return { error: failure === "storage_verification" ? { message: "SECRET" } : null, data: { size: failure === "stored_undersized" ? 1 : 1200 } }; },
      remove: async () => ({ error: null }),
    }) };
    const fetch = async () => new Response(failure === "pdf_generation" ? "SECRET" : new Uint8Array(failure === "pdf_validation" ? 1 : 1200), { status: failure === "pdf_generation" ? 500 : 200 });
    const prepare = new Function("supabase", "fetch", "HELPER_UPLOAD_BUCKET", "getReportPdfFileName", "getPdfFileNameFromResponse", `${javascript}; return generateAndStageLetterPdf;`)(
      { storage }, fetch, "synthetic", () => "fixture.pdf", () => "fixture.pdf",
    );
    const operation = prepare({ origin: "https://example.invalid", draftId: "synthetic", draft: {}, signal: new AbortController().signal, diagnostics });
    if (failure === "success") { assert.equal((await operation).contentType, "application/pdf"); assert.equal(uploaded, 1); assert.equal(downloaded, 1); }
    else {
      await assert.rejects(operation);
      assert.equal(diagnostics.failure().stage, failure === "stored_undersized" ? "storage_verification" : failure);
      assert.doesNotMatch(JSON.stringify(diagnostics.failure()), /SECRET/);
    }
  });
}
test("enqueue deduplication remains draft scoped and insertion has no global active-job guard", () => {
  const lookup = source.slice(source.indexOf("async function activeJob()"), source.indexOf("const transition ="));
  assert.match(lookup, /\.eq\("payload->>draftId", draftId\)/);
  assert.match(lookup, /\["pending", "processing"\]/);
  const insert = readFileSync("lib/mediref/helper-jobs.ts", "utf8");
  assert.doesNotMatch(insert, /\.in\("status"|\.eq\("status"/);
});
