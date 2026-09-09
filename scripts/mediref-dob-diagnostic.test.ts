import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { parseDobDiagnosticInput, startDobObservation } from "./mediref-dob-diagnostic";

test("diagnostic input accepts a calendar date and rejects invalid input with a fixed error", () => {
  const valid = { patient: { firstName: "Fixture", lastName: "Only", dob: "1990-06-09" } };
  assert.deepEqual(parseDobDiagnosticInput(valid), valid);
  for (const value of [null, {}, { patient: { ...valid.patient, dob: "1990-02-31" } }, { patient: { ...valid.patient, firstName: "" } }]) {
    assert.throws(() => parseDobDiagnosticInput(value), { message: "Invalid MediRef DOB diagnostic input." });
  }
});

test("manual observer returns sanitized comparisons and cleans up listeners", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent(`<form><section>
      <div data-date-field-input role="group">
        <span role="spinbutton" data-segment="day" tabindex="0" contenteditable="true" aria-valuenow="1">01</span>
        <span role="spinbutton" data-segment="month" tabindex="0" contenteditable="true" aria-valuenow="1">01</span>
        <span role="spinbutton" data-segment="year" tabindex="0" contenteditable="true" aria-valuenow="2001">2001</span>
      </div>
      <input type="hidden" name="dob" value="">
      <input type="hidden" name="PRIVATE-PATIENT-KEY" value="PRIVATE-TOKEN">
      <button type="button">Outside</button>
    </section></form>`);
    const observation = await startDobObservation(page, "1990-06-09");
    try {
      const before = await observation.evaluate(o => o.snapshot());
      assert.deepEqual(before.segmentCounts, { day: 1, month: 1, year: 1 });
      assert.equal(before.associatedFieldStateChanged, false);
      assert.equal(before.candidates[0].valueEmpty, true);
      assert.equal(before.candidates[1].safeNameKey, "other");
      // Text-only edits must remain distinguishable from any associated form-state change.
      await page.locator('[data-segment="year"]').evaluate(e => { e.textContent = "1990"; });
      const textOnly = await observation.evaluate(o => o.snapshot());
      assert.equal(textOnly.associatedFieldStateChanged, false);
      assert.equal(textOnly.yearAriaNowChangedAfterCommit, false);
      assert.equal(textOnly.candidates[0].matchesExpectedDob, false);
      // Local fixture simulates a manual application handler; production observer never writes state.
      await page.evaluate(() => {
        const group = document.querySelector('[data-date-field-input]')!;
        const field = group.querySelector('[data-segment="year"]') as HTMLElement;
        field.focus();
        for (const type of ["beforeinput", "input", "change"]) field.dispatchEvent(new InputEvent(type, { bubbles: true, data: "PRIVATE-EVENT-DATA" }));
        for (const type of ["keydown", "keyup"]) field.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: "PRIVATE-KEY" }));
        for (const [part, value] of [["day", "09"], ["month", "06"], ["year", "1990"]]) {
          const segment = group.querySelector(`[data-segment="${part}"]`)!;
          segment.textContent = value; segment.setAttribute("aria-valuenow", String(Number(value)));
        }
        (document.querySelector('input[name="dob"]') as HTMLInputElement).value = "1990-06-09";
        group.setAttribute("data-value", "1990-06-09");
        group.setAttribute("data-PRIVATE-ATTRIBUTE", "PRIVATE-VALUE");
        group.setAttribute("aria-invalid", "false");
        document.querySelector("button")!.focus();
      });
      const after = await observation.evaluate(o => o.snapshot());
      const records = await observation.evaluate(o => o.drain());
      assert.equal(after.associatedFieldStateChanged, true);
      assert.equal(after.candidates[0].matchesExpectedDob, true);
      assert.equal(after.candidates[0].valueEmpty, false);
      assert.equal(after.yearAriaNowChangedAfterCommit, true);
      assert.equal(after.groupStateChangedAfterCommit, true);
      assert.equal(after.visiblePartsMatchExpected, true);
      assert.equal(after.activeElementInsideDobGroup, false);
      assert.equal(after.hasSerializedDobField, true);
      assert.equal(after.focusoutObserved, true);
      for (const type of ["beforeinput", "input", "change", "blur", "focusout", "keydown", "keyup"]) assert.ok(after.observedEventTypes.includes(type));
      assert.ok(records.mutations.some(record => record.attributeName === "other"));
      for (const record of records.events) assert.deepEqual(Object.keys(record).sort(), ["eventType", "tagName", "role", "dataSegment", "insideDobGroup"].sort());
      const safe = JSON.stringify({ before, after, records });
      for (const privateValue of ["1990", "2001", "PRIVATE", "private", "1990-06-09"]) assert.ok(!safe.includes(privateValue));
      await page.evaluate(() => window.dispatchEvent(new Event("mediref-dob-diagnostic-done")));
      assert.equal((await observation.evaluate(o => o.snapshot())).explicitSignal, true);
      await observation.evaluate(o => o.stop());
      await page.locator('[data-segment="day"]').dispatchEvent("change");
      assert.deepEqual(await observation.evaluate(o => o.drain()), { events: [], mutations: [] });
    } finally { await observation.evaluate(o => o.stop()); await observation.dispose(); }
  } finally { await browser.close(); }
});
