import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { enterPatientDob } from "./mediref-dob";

test("MediRef DOB entry in an isolated local browser", async (t) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  const enter = () => enterPatientDob(page, "1990-06-09", "09/06/1990");
  try {
    for (const type of ["text", "date"]) {
      await t.test(`legacy ${type} input`, async () => {
        await page.setContent(`<label for="birth">Date of birth</label><input id="birth" type="${type}">`);
        assert.equal(await enter(), true);
        assert.equal(await page.locator("input").inputValue(), type === "date" ? "1990-06-09" : "09/06/1990");
      });
    }
    await t.test("labelled segmented inputs in month/year/day order", async () => {
      await page.setContent(`<div id="dob" role="group" data-testid="patient-dob-input" aria-label="DOB">
        <input aria-label="Month" value="12"><input aria-label="Year" value="2001"><input aria-label="Day" value="31">
      </div>`);
      assert.equal(await enter(), true);
      assert.deepEqual(await page.locator("input").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)), ["06", "1990", "09"]);
    });
    await t.test("keyboard-driven non-input spinbuttons", async () => {
      // Synthetic keyboard fixture, not a captured MediRef DOM snapshot.
      await page.setContent(`<div id="dob" role="group" data-date-field-input aria-label="DOB">
        ${["month", "day", "year"].map((part) => `<span tabindex="0" role="spinbutton" aria-label="${part}" aria-valuenow="1">1</span>`).join("")}
      </div>`);
      await page.locator('[role="spinbutton"]').evaluateAll((elements) => {
        for (const element of elements) {
          let digits = "";
          element.addEventListener("keydown", (event) => {
            const key = (event as KeyboardEvent).key;
            if (key === "ArrowUp") digits = "";
            if (/^\d$/.test(key)) {
              event.preventDefault();
              digits += key;
              element.setAttribute("aria-valuenow", String(Number(digits)));
              element.textContent = String(Number(digits));
            }
          });
        }
      });
      assert.equal(await enter(), true);
      assert.deepEqual(await page.locator('[role="spinbutton"]').evaluateAll((els) => els.map((el) => el.getAttribute("aria-valuenow"))), ["6", "9", "1990"]);
    });
    for (const composite of [false, true]) {
      await t.test(`waits for delayed ${composite ? "segments" : "standard input"}`, async () => {
        await page.setContent(composite ? '<div data-date-field-input></div>' : '<main></main>');
        await page.evaluate((segmented) => {
          setTimeout(() => {
            if (segmented) {
              document.querySelector("[data-date-field-input]")!.innerHTML =
                '<input aria-label="Day"><input aria-label="Month"><input aria-label="Year">';
            } else {
              document.querySelector("main")!.innerHTML = '<input aria-label="DOB">';
            }
          }, 250);
        }, composite);
        assert.equal(await enter(), true);
      });
    }
    await t.test("detects a value cleared when focus leaves a reordered group", async () => {
      await page.setContent(`<div data-date-field-input>
        <input aria-label="Month"><input aria-label="Year"><input aria-label="Day">
      </div><button>Next</button>`);
      await page.locator("[data-date-field-input]").evaluate((group) => {
        group.addEventListener("focusout", (event) => {
          if (!group.contains((event as FocusEvent).relatedTarget as Node | null)) {
            group.querySelector<HTMLInputElement>('[aria-label="Year"]')!.value = "";
          }
        });
      });
      await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
    });
    await t.test("failure diagnostics contain only counts and recognised part names", async () => {
      await page.setContent('<div data-date-field-input><input aria-label="Day private-patient-marker"></div>');
      const warnings: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => { warnings.push(args); };
      try {
        await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
      } finally {
        console.warn = originalWarn;
      }
      assert.deepEqual(warnings, [["[MediRef] DOB control entry failed", {
        standardEditableInputs: 0, compositeGroups: 1, candidateSegments: 1, identifiedParts: ["day"],
      }]]);
      assert.ok(!JSON.stringify(warnings).includes("private-patient-marker"));
      assert.ok(!JSON.stringify(warnings).includes("1990"));
    });
    for (const [name, html] of [
      ["absent", "<input aria-label='Patient name'>"],
      ["unlabelled", '<div data-date-field-input><input><input><input></div>'],
      ["incomplete", '<div data-date-field-input><input aria-label="Day"></div>'],
      ["unresponsive", '<div data-date-field-input><span role="spinbutton" tabindex="0" aria-label="Day">1</span><span role="spinbutton" tabindex="0" aria-label="Month">1</span><span role="spinbutton" tabindex="0" aria-label="Year">2000</span></div>'],
    ]) {
      await t.test(`fails clearly for ${name} control`, async () => {
        await page.setContent(html);
        await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
      });
    }
  } finally {
    await browser.close();
  }
});
