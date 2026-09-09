import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { performQueuedIconAction } from "./complete-workflow";

test("icon helper allows observed 22-second completion and preserves exact request", async () => {
  const source = await readFile(new URL("../../app/api/report-writing/update-praktika-letter-icons/route.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function updatePraktikaAppointmentIcons("), source.indexOf("async function markDraftIconUpdated("));
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const failure of ["none", "insert", "execute", "timeout"]) {
    const events: string[] = [];
    const run = runInNewContext(`${compiled}\nupdatePraktikaAppointmentIcons`, {
      LETTER_SENT_ICON_ID: 6597, console: { log() {} }, buildRequestId: () => "fixture",
      performQueuedIconAction,
      createPraktikaHelperJob: async (options: { jobType: string; request: { path: string; body: Record<string, number>[] } }) => {
        events.push("insert");
        assert.equal(options.jobType, "update_praktika_letter_icons");
        assert.equal(options.request.path, "/php/forms/db_commitFormData.php");
        assert.equal(options.request.body[0].appointment_icon2id, 6597);
        if (failure === "insert") throw new Error("insertion failed");
        return { id: "fixture" };
      },
      saveIconStatus: async () => { events.push("running"); },
      waitForPraktikaHelperJob: async (_id: string, options: { timeoutMs: number }) => {
        events.push("wait"); assert.ok(options.timeoutMs > 22044);
        if (failure !== "none") throw new Error(failure === "timeout" ? "Praktika helper job did not finish in time." : "execution failed");
        return { response: { appointment_icon2id: 6597 } };
      },
    });
    const result = run({ draftId: "fixture", mode: { scope: "practice" }, practiceId: 1, appointmentId: "123", iconIds: [0,6597,0,0] });
    if (failure === "none") assert.equal((await result).appointment_icon2id, 6597);
    else await assert.rejects(result);
    assert.deepEqual(events, failure === "insert" ? ["insert"] : ["insert", "running", "wait"]);
  }
});

test("historical pending-icon replacement preserves other appointment icons", async () => {
  const source = await readFile(new URL("../../app/api/report-writing/update-praktika-letter-icons/route.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function replaceLetterWorkflowIcons("), source.indexOf("async function findQueueItem("));
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const replace = runInNewContext(`${compiled}\nreplaceLetterWorkflowIcons`, { PENDING_LETTER_ICON_IDS: [7360,7341], LETTER_SENT_ICON_ID:6597 });
  assert.deepEqual(Array.from(replace([42,7360,7341,0]).updatedIconIds), [42,6597,6597,0]);
  assert.equal(replace([42,0,0,0]).changed, false);
});
