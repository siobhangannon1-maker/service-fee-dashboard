import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { enterPatientDob, classifyYearState } from "./mediref-dob";

for (const [name, sources, allExpected, anyExpected, agree] of [
  ["correct four digits", ["1990", "1990", "1990"], true, true, true],
  ["two digits", ["42", "42", "42"], false, false, true],
  ["first two digits", ["19", "19", "19"], false, false, true],
  ["last two digits", ["90", "90", "90"], false, false, true],
  ["stale aria-valuenow", ["2001", "1990", "1990"], false, true, false],
  ["stale text", ["1990", "1990", "2001"], false, true, false],
  ["all wrong", ["2001", "2001", "2001"], false, false, true],
  ["descriptive and missing sources", [null, "private descriptive label", "1990"], true, true, null],
  ["bidi normalization", ["\u200e1990", "1990", " 1990 "], true, true, true],
  ["too many digits", ["19900", "19900", "19900"], false, false, true],
] as const) {
  test(`safe year classification: ${name}`, () => {
    const result = classifyYearState({ sources: [...sources], min: "1", max: "9999", placeholder: false }, "1990");
    assert.equal(result.allExpected, allExpected);
    assert.equal(result.anyExpected, anyExpected);
    assert.equal(result.numericSourcesAgree, agree);
    assert.equal(result.ariaValueNow.matchesExpectedFirst2Digits, name === "first two digits");
    assert.equal(result.ariaValueNow.matchesExpectedLast2Digits, name === "last two digits");
    assert.equal(result.textContent.digitCount, name === "too many digits" ? ">4" : ["two digits", "first two digits", "last two digits"].includes(name) ? 2 : 4);
    assert.equal(result.textContent.withinAriaMinMax, name !== "too many digits");
    for (const source of [result.ariaValueNow, result.ariaValueText, result.textContent]) {
      assert.deepEqual(Object.keys(source).sort(), ["sourcePresent", "numericParseable", "digitCount", "matchesExpected", "matchesExpectedLast2Digits", "matchesExpectedFirst2Digits", "withinAriaMinMax"].sort());
    }
    if (name === "descriptive and missing sources") {
      assert.equal(result.ariaValueNow.sourcePresent, false);
      assert.equal(result.ariaValueText.numericParseable, false);
      assert.equal(result.ariaValueText.digitCount, 0);
      assert.equal(result.ariaValueText.withinAriaMinMax, null);
    }
    for (const privateValue of ["1990", "2001", "19900", "9999", "private descriptive label"]) assert.ok(!JSON.stringify(result).includes(privateValue));
  });
}
test("year bounds are diagnostic only and unknown bounds remain null", () => {
  const state = { sources: ["1990", "1990", "1990"], min: "2000", max: "2099", placeholder: false };
  assert.equal(classifyYearState(state, "1990").allExpected, true);
  assert.equal(classifyYearState(state, "1990").textContent.withinAriaMinMax, false);
  assert.equal(classifyYearState({ ...state, min: null }, "1990").textContent.withinAriaMinMax, null);
  assert.equal(classifyYearState({ ...state, placeholder: true }, "1990").allExpected, false);
});

test("MediRef DOB entry in an isolated local browser", async (t) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  const enter = () => enterPatientDob(page, "1990-06-09", "09/06/1990");
  try {
    for (const mode of ["converges-on-blur", "reverts-on-blur", "persistent-conflict", "day-changes-on-blur", "month-changes-on-blur", "wrong-before-blur", "non-numeric-text", "wrong-after-blur", "wrong-digit-count", "readonly-after-blur", "consistent"]) {
      await t.test(`provisional year commit: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" data-segment="year" aria-valuemin="1" aria-valuemax="9999" aria-valuenow="2001">2001</span>
        </div><button>Outside</button>`);
        await page.evaluate(mode => {
          for (const field of document.querySelectorAll<HTMLElement>('[data-segment]')) {
            field.addEventListener("input", () => {
              if (field.dataset.segment !== "year" || mode === "consistent") field.setAttribute("aria-valuenow", String(Number(field.textContent)));
              if (field.dataset.segment === "year" && mode === "wrong-before-blur") field.textContent = "1980";
              if (field.dataset.segment === "year" && mode === "non-numeric-text") { field.setAttribute("aria-valuenow", field.textContent!); field.textContent = "yyyy"; }
            });
            if (field.dataset.segment === "year") field.addEventListener("blur", () => {
              document.body.dataset.yearBlurred = "true";
              if (mode === "persistent-conflict") return;
              setTimeout(() => {
                if (mode === "reverts-on-blur") field.textContent = "2001";
                field.setAttribute("aria-valuenow", String(Number(field.textContent)));
                if (mode === "wrong-after-blur") field.textContent = "1980";
                if (mode === "wrong-digit-count") field.textContent = "01990";
                if (mode === "readonly-after-blur") field.setAttribute("aria-readonly", "true");
                if (["day-changes-on-blur", "month-changes-on-blur"].includes(mode)) {
                  const changed = document.querySelector(mode === "day-changes-on-blur" ? '[data-segment="day"]' : '[data-segment="month"]')!;
                  changed.textContent = "08"; changed.setAttribute("aria-valuenow", "8");
                }
              }, 100);
            });
          }
        }, mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (["converges-on-blur", "persistent-conflict", "consistent"].includes(mode)) assert.equal(await enter(), true);
          else await assert.rejects(enter, /Unable to enter patient DOB in MediRef date control/);
        } finally { console.log = originalLog; console.warn = originalWarn; }
        assert.equal(await page.locator("body").getAttribute("data-year-blurred"), ["wrong-before-blur", "non-numeric-text"].includes(mode) ? null : "true");
        if (!["wrong-before-blur", "non-numeric-text", "consistent"].includes(mode)) assert.deepEqual(logs.find(row => row[0] === "[MediRef] DOB year_provisional_acceptance")![1], { provisionalYearVisibleMatch: true });
        if (mode === "persistent-conflict") {
          assert.ok(logs.some(row => row[0] === "[MediRef] DOB final verification completed"));
          const flags = logs.find(row => row[0] === "[MediRef] DOB year_post_blur_classification")![1] as Record<string, boolean>;
          assert.equal(flags.year_post_blur_visible_value_persisted, true);
          assert.equal(flags.year_post_blur_aria_now_matches_expected, false);
          assert.equal(flags.yearAriaStateDiffersFromVisible, true);
        }
        if (mode === "reverts-on-blur") {
          const flags = logs.find(row => row[0] === "[MediRef] DOB year_post_blur_classification")![1] as Record<string, boolean>;
          assert.equal(flags.year_post_blur_visible_value_persisted, false);
        }
        for (const value of ["1990", "2001", "9999", "1980"]) assert.ok(!JSON.stringify(logs).includes(value));
      });
    }
    for (const mode of ["later-correct", "later-convergence", "later-divergence-and-convergence", "wrong-through-deadline"]) {
      await t.test(`year verification diagnostics: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" data-segment="year" aria-valuemin="1" aria-valuemax="9999" aria-valuenow="2001">2001</span>
        </div><button>Outside</button>`);
        await page.evaluate(mode => {
          for (const field of document.querySelectorAll<HTMLElement>('[data-segment]')) {
            field.addEventListener("input", () => {
              if (field.dataset.segment !== "year") { field.setAttribute("aria-valuenow", String(Number(field.textContent))); return; }
              const entered = field.textContent!;
              field.setAttribute("aria-valuenow", "2001");
              if (mode !== "later-convergence") field.textContent = "2001";
              if (mode === "later-divergence-and-convergence") setTimeout(() => { field.textContent = entered; }, 150);
              if (mode !== "wrong-through-deadline") setTimeout(() => {
                const replacement = field.cloneNode(true) as HTMLElement;
                replacement.textContent = entered; replacement.setAttribute("aria-valuenow", String(Number(entered)));
                field.replaceWith(replacement);
              }, mode === "later-divergence-and-convergence" ? 350 : 150);
            });
          }
        }, mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (mode === "wrong-through-deadline") await assert.rejects(enter, /Unable to enter patient DOB in MediRef date control/);
          else assert.equal(await enter(), true);
        } finally { console.log = originalLog; console.warn = originalWarn; }
        const samples = logs.filter(row => row[0] === "[MediRef] DOB year_state_sample").map(row => row[1] as ReturnType<typeof classifyYearState>);
        assert.equal(samples[0].allExpected, false);
        const summary = logs.find(row => row[0] === "[MediRef] DOB year_state_verification")![1] as Record<string, boolean | number>;
        assert.ok(Number(summary.samples) > 1);
        assert.equal(summary.expectedStateAppearedLater, mode !== "wrong-through-deadline");
        assert.equal(summary.stateChangedAfterInitialSample, mode !== "wrong-through-deadline");
        assert.equal(summary.sourcesConverged, ["later-convergence", "later-divergence-and-convergence"].includes(mode));
        assert.equal(summary.remainedNonmatching, mode === "wrong-through-deadline");
        assert.equal(samples.at(-1)!.allExpected, mode !== "wrong-through-deadline");
        assert.equal(samples[0].anyExpected, mode === "later-convergence");
        for (const value of ["1990", "2001", "9999"]) assert.ok(!JSON.stringify(logs).includes(value));
      });
    }
    for (const mode of ["missing-selection", "lost-focus", "replaced-node", "selectText-timeout"]) {
      await t.test(`custom day selection diagnostics: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="day">31</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="month">12</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="year">2001</span>
        </div><button>Next</button>`);
        await page.evaluate(mode => {
          const day = document.querySelector<HTMLElement>('[data-segment="day"]')!;
          if (mode === "lost-focus") {
            const year = document.querySelector<HTMLElement>('[data-segment="year"]')!;
            year.setAttribute("aria-valuenow", "2001");
            year.addEventListener("input", () => year.setAttribute("aria-valuenow", String(Number(year.textContent))));
          }
          if (mode === "selectText-timeout") day.addEventListener("focus", () => { day.style.display = "none"; });
          if (mode === "replaced-node") day.addEventListener("focus", () => day.replaceWith(day.cloneNode(true)), { once: true });
          const getSelection = document.getSelection.bind(document);
          document.getSelection = () => {
            if (mode === "lost-focus") document.querySelector("button")!.focus();
            return mode === "lost-focus" ? getSelection() : null;
          };
        }, mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (mode === "lost-focus") assert.equal(await enter(), true);
          else await assert.rejects(enter, /Unable to enter patient DOB in MediRef date control/);
        }
        finally { console.log = originalLog; console.warn = originalWarn; }
        const has = (phase: string) => logs.some(row => row[0] === `[MediRef] DOB ${phase}`);
        assert.ok(has("day_selection_started"));
        assert.equal(has("day_selectText_completed"), mode !== "selectText-timeout");
        assert.equal(has("day_single_insert_started"), mode === "lost-focus");
        if (mode !== "selectText-timeout") {
          const diagnostic = logs.find(row => row[0] === "[MediRef] DOB day_selection_inspection")![1] as Record<string, unknown>;
          assert.deepEqual(Object.keys(diagnostic).sort(), ["activeElementIsDay", "selectionExists", "rangeCount", "anchorInsideDay", "focusInsideDay", "rangeInsideDay", "nodeDetached", "nodeChanged", "insideDobGroup"].sort());
          assert.ok(Object.values(diagnostic).every(value => typeof value === "boolean" || typeof value === "number"));
          assert.equal(diagnostic.nodeChanged, mode === "replaced-node");
          assert.equal(diagnostic.nodeDetached, mode === "replaced-node");
          if (mode === "lost-focus") assert.equal(diagnostic.activeElementIsDay, false);
          else assert.equal(diagnostic.selectionExists, false);
        }
        // Restore browser globals for the remaining fixtures.
        await page.evaluate(() => { delete (document as unknown as Record<string, unknown>).getSelection; });
      });
    }
    for (const mode of ["accepted", "no-effect", "partial-range", "anchor-outside", "focus-outside", "replaced", "detached", "conflict", "commit-only", "already-correct", "other-part", "readonly"]) {
      await t.test(`contained custom selection with unrelated active button: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="year" aria-valuenow="2001">2001</span>
        </div><button>Outside</button>`);
        await page.evaluate(mode => {
          const day = document.querySelector<HTMLElement>('[data-segment="day"]')!;
          const month = document.querySelector<HTMLElement>('[data-segment="month"]')!;
          const year = document.querySelector<HTMLElement>('[data-segment="year"]')!;
          const button = document.querySelector("button")!;
          if (mode === "already-correct") { day.textContent = "09"; day.setAttribute("aria-valuenow", "9"); }
          // With unrelated active focus, Chromium targets beforeinput at the button.
          // Cancel the real event at document level; do not stub insertText.
          if (mode === "no-effect") document.addEventListener("beforeinput", event => event.preventDefault(), { capture: true, once: true });
          for (const field of [day, month]) field.addEventListener("focus", () => button.focus());
          if (mode === "replaced" || mode === "detached") day.addEventListener("focus", () => {
            if (mode === "replaced") day.replaceWith(day.cloneNode(true));
            else day.remove();
          }, { once: true });
          for (const field of [day, month, year]) {
            field.addEventListener("input", () => {
              field.setAttribute("aria-valuenow", ["conflict", "commit-only"].includes(mode) && field === day ? "31" : String(Number(field.textContent)));
              if (mode === "other-part" && field === day) month.textContent = "11";
              // The fixture component advances to year after committing month.
              // No fake insertion or activeElement override: Chromium performs the edit.
              if (field === month) year.focus();
            });
          }
          if (mode === "commit-only") day.addEventListener("blur", () => day.setAttribute("aria-valuenow", String(Number(day.textContent))));
          const getSelection = document.getSelection.bind(document);
          document.getSelection = () => {
            const selection = getSelection()!;
            if (mode === "readonly") day.setAttribute("aria-readonly", "true");
            if (["partial-range", "anchor-outside", "focus-outside"].includes(mode)) {
              const range = document.createRange();
              if (mode === "partial-range") {
                range.setStart(day.parentElement!, 0); range.setEnd(day.firstChild!, 2);
                selection.removeAllRanges(); selection.addRange(range);
              } else if (mode === "anchor-outside") selection.setBaseAndExtent(month.firstChild!, 1, day.firstChild!, 0);
              else selection.setBaseAndExtent(day.firstChild!, 0, month.firstChild!, 1);
            }
            return selection;
          };
        }, mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (mode === "accepted") assert.equal(await enter(), true);
          else await assert.rejects(enter, /Unable to enter patient DOB in MediRef date control/);
        } finally {
          console.log = originalLog; console.warn = originalWarn;
          await page.evaluate(() => { delete (document as unknown as Record<string, unknown>).getSelection; });
        }
        const inserted = logs.some(row => row[0] === "[MediRef] DOB day_single_insert_started");
        assert.equal(inserted, ["accepted", "no-effect", "conflict", "commit-only", "already-correct", "other-part"].includes(mode));
        if (mode === "accepted") {
          for (const part of ["day", "month"]) {
            const selection = logs.find(row => row[0] === `[MediRef] DOB ${part}_selection_safety`)![1];
            assert.deepEqual(selection, { activeElementIsPart: false, selectionInsidePart: true });
            const state = logs.find(row => row[0] === `[MediRef] DOB ${part}_single_insert_completed`)![1] as Record<string, boolean>;
            assert.equal(state.stateChangedAfterInsert, true);
            assert.equal(state.expectedStateObserved, true);
          }
          assert.deepEqual(await page.locator('[data-segment]').allTextContents(), ["09", "06", "1990"]);
        }
        if (["no-effect", "conflict", "commit-only"].includes(mode)) {
          const state = logs.find(row => row[0] === "[MediRef] DOB day_single_insert_completed")![1] as Record<string, boolean>;
          assert.equal(state.expectedStateObserved, false);
        }
        assert.ok(!JSON.stringify(logs).includes("1990"));
      });
    }
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
    for (const tag of ["div", "span"]) {
      await t.test(`contenteditable ${tag} segments with beforeinput, placeholders and auto-advance`, async () => {
        // React Aria-style semantics, not a captured MediRef DOM or a claim about its library.
        await page.setContent(`<div id="dob" role="group" data-date-field-input aria-label="DOB">
          ${["month", "year", "day"].map((part) => `<${tag} tabindex="0" role="spinbutton"
            contenteditable="true" data-type="${part}" aria-label="${part}, DOB"
            aria-valuenow="${part === "year" ? "2001" : "12"}">${part === "year" ? "2001" : "12"}</${tag}>`).join("")}
          </div><button>Next</button>`);
        await page.locator('[role="spinbutton"]').evaluateAll((elements) => {
          elements.forEach((element, index) => {
            let digits = "";
            let pending: ReturnType<typeof setTimeout>;
            const part = element.getAttribute("data-type");
            const max = part === "year" ? 9999 : part === "month" ? 12 : 31;
            const state = { update(value: string) {
              clearTimeout(pending);
              pending = setTimeout(() => {
                element.setAttribute("data-placeholder", String(!value));
                // Aria-valuenow can remain populated while the display is a placeholder.
                element.setAttribute("aria-valuenow", value ? String(Number(value)) : "1");
                element.textContent = value || part;
              }, 20);
            } };
            element.addEventListener("focus", () => { digits = ""; });
            element.addEventListener("keydown", (event) => {
              const key = event as KeyboardEvent;
              if (part !== "year" && (key.ctrlKey || key.metaKey) && key.key === "a") key.preventDefault();
              if (key.key === "Backspace") {
                key.preventDefault();
                if (element.getAttribute("data-placeholder") === "true") {
                  (elements[Math.max(0, index - 1)] as HTMLElement).focus();
                } else {
                  digits = (element.textContent || "").slice(0, -1);
                  state.update(digits);
                }
              }
              // Digits are handled only through beforeinput, never a fake keydown writer.
            });
            element.addEventListener("beforeinput", (event) => {
              event.preventDefault();
              const key = (event as InputEvent).data;
              if (!key || !/^\d+$/.test(key)) return;
              digits += key;
              if (Number(digits) > max) digits = key;
              state.update(digits);
              if (Number(digits + "0") > max || digits.length >= String(max).length) {
                digits = "";
                if (part !== "month") (elements[index + 1] as HTMLElement | undefined)?.focus();
              }
            });
          });
        });
        if (tag === "span") {
          await page.locator('[role="spinbutton"]').evaluateAll((elements) => {
            for (const element of elements) {
              element.setAttribute("data-placeholder", "true");
              element.setAttribute("aria-valuenow", "1");
              element.textContent = element.getAttribute("data-type");
            }
          });
        }
        assert.equal(await enter(), true);
        assert.deepEqual(await page.locator('[role="spinbutton"]').evaluateAll((els) =>
          els.map((el) => ({ value: el.getAttribute("aria-valuenow"), hasValue: "value" in el }))),
          [{ value: "6", hasValue: false }, { value: "1990", hasValue: false }, { value: "9", hasValue: false }]);
      });
    }
    await t.test("live-style spans replace a wrong DOB without permitting an empty state", async () => {
      await page.setContent(`<div role="group" data-testid="patient-dob-input">
        <span role="spinbutton" contenteditable="true" data-segment="month" aria-valuenow="12">12</span>
        <span role="spinbutton" contenteditable="true" data-segment="year" aria-valuenow="2001">2001</span>
        <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuenow="31">31</span>
      </div><button>Next</button>`);
      await page.locator('[data-segment]').evaluateAll((elements) => {
        for (const element of elements) {
          element.addEventListener("beforeinput", (event) => {
            const input = event as InputEvent;
            if (input.inputType.startsWith("delete")) {
              event.preventDefault();
              return;
            }
            // Record that the first digit replaces the whole segment via an actual selection.
            if (!element.hasAttribute("data-selection-checked")) {
              element.setAttribute("data-selection-checked", String(
                document.getSelection()?.toString() === element.textContent));
            }
          });
          element.addEventListener("input", () => {
            // Browser editing supplies the text; the component publishes its numeric state later.
            const value = element.textContent || "";
            if (!value) element.setAttribute("data-was-empty", "true");
            setTimeout(() => element.setAttribute("aria-valuenow", String(Number(value))), 20);
          });
        }
      });
      const day = page.locator('[data-segment="day"]');
      await day.selectText();
      await day.press("Backspace");
      assert.equal(await day.textContent(), "31");
      assert.equal(await enter(), true);
      assert.deepEqual(await page.locator('[data-segment]').evaluateAll((elements) => elements.map((el) => ({
        value: el.getAttribute("aria-valuenow"), selected: el.getAttribute("data-selection-checked"),
        wasEmpty: el.hasAttribute("data-was-empty"), hasValue: "value" in el,
      }))), ["6", "1990", "9"].map((value) => ({ value, selected: "true", wasEmpty: false, hasValue: false })));
    });
    for (const revert of [false, true]) {
      await t.test(`custom segments commit on blur and ${revert ? "reject re-rendered reversion" : "persist after re-render"}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" data-segment="year" aria-valuenow="2001">2001</span>
          <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuenow="31">31</span>
        </div><button>Next</button>`);
        await page.locator('[data-date-field-input]').evaluate((group, shouldRevert) => {
          for (const element of group.querySelectorAll('[data-segment]')) {
            element.addEventListener("input", () => element.setAttribute("aria-valuenow", String(Number(element.textContent))));
            element.addEventListener("blur", () => {
              const value = element.textContent || "";
              setTimeout(() => element.setAttribute("aria-valuenow", String(Number(value))), 20);
            });
          }
          group.addEventListener("focusout", () => {
            const fields = Array.from(group.querySelectorAll('[data-segment]'));
            if (fields.map((field) => field.textContent).join(",") !== "05,1958,09") return;
            setTimeout(() => {
              const replacement = group.cloneNode(true) as HTMLElement;
              if (shouldRevert) {
                const day = replacement.querySelector('[data-segment="day"]')!;
                day.setAttribute("aria-valuenow", "31"); day.textContent = "31";
              }
              group.replaceWith(replacement);
            }, 100);
          });
        }, revert);
        const enterDate = () => enterPatientDob(page, "1958-05-09", "09/05/1958");
        if (revert) await assert.rejects(enterDate, { message: "Unable to enter patient DOB in MediRef date control" });
        else {
          assert.equal(await enterDate(), true);
          assert.equal(await page.locator('[data-segment="month"]').getAttribute("aria-valuenow"), "5");
        }
      });
    }
    await t.test("numeric aria-valuetext is supported but conflicting numeric state is rejected", async () => {
      await page.setContent(`<div data-date-field-input>
        <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuetext="31">31</span>
        <input aria-label="Month"><input aria-label="Year">
      </div>`);
      await page.locator('[data-segment="day"]').evaluate((field) => {
        field.addEventListener("input", () => field.setAttribute("aria-valuetext", field.textContent || ""));
      });
      assert.equal(await enter(), true);
      await page.locator('[data-segment="day"]').evaluate((field) => field.setAttribute("aria-valuenow", "31"));
      await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
    });
    for (const mode of ["accepted", "outside-selection", "no-effect", "conflict", "other-part", "revert", "replaced", "detached", "keyboard-only"]) {
      await t.test(`atomic custom year with unrelated active button: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="year" inputmode="numeric"
            aria-valuemin="1" aria-valuemax="9999" aria-valuenow="2001" aria-valuetext="2001">2001</span>
        </div><button>Outside</button>`);
        await page.evaluate(mode => {
          const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-segment]'));
          const year = document.querySelector<HTMLElement>('[data-segment="year"]')!;
          const button = document.querySelector("button")!;
          document.addEventListener("keydown", () => { document.body.dataset.keyboardUsed = "true"; });
          for (const field of fields) {
            if (field !== year || mode !== "revert") field.addEventListener("focus", () => button.focus());
            field.addEventListener("input", event => {
              field.setAttribute("aria-valuenow", String(Number(field.textContent)));
              if (field === year) {
                field.setAttribute("aria-valuetext", mode === "conflict" ? "2001" : String(Number(field.textContent)));
                field.dataset.insertions = String(Number(field.dataset.insertions || 0) + 1);
                field.dataset.insertLength = String((event as InputEvent).data?.length);
                if (mode === "other-part") fields[0].textContent = "08";
              }
            });
          }
          document.addEventListener("beforeinput", event => {
            const selection = window.getSelection();
            if (year.contains(selection?.anchorNode ?? null) && ["no-effect", "keyboard-only"].includes(mode)) event.preventDefault();
          }, true);
          if (mode === "replaced" || mode === "detached") year.addEventListener("focus", () => {
            if (mode === "replaced") year.replaceWith(year.cloneNode(true));
            else year.remove();
          }, { once: true });
          if (mode === "revert") year.addEventListener("blur", () => {
            setTimeout(() => {
              year.textContent = "2001"; year.setAttribute("aria-valuenow", "2001"); year.setAttribute("aria-valuetext", "2001");
            }, 100);
          });
          const getSelection = document.getSelection.bind(document);
          document.getSelection = () => {
            const selection = getSelection()!;
            if (mode === "outside-selection" && year.contains(selection.anchorNode)) {
              const range = document.createRange(); range.selectNodeContents(document.body);
              selection.removeAllRanges(); selection.addRange(range);
            }
            return selection;
          };
        }, mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (["accepted", "conflict"].includes(mode)) assert.equal(await enter(), true);
          else await assert.rejects(enter, /Unable to enter patient DOB in MediRef date control/);
        } finally {
          console.log = originalLog; console.warn = originalWarn;
          await page.evaluate(() => { delete (document as unknown as Record<string, unknown>).getSelection; });
        }
        const has = (phase: string) => logs.some(row => row[0] === `[MediRef] DOB ${phase}`);
        assert.equal(has("year_single_insert_started"), !["outside-selection", "replaced", "detached"].includes(mode));
        assert.equal(has("month_pre_navigation_focus"), false);
        assert.equal(has("year_selection_focus_started"), false);
        assert.equal(await page.locator("body").getAttribute("data-keyboard-used"), null);
        if (["accepted", "conflict"].includes(mode)) {
          for (const part of ["day", "month", "year"]) {
            assert.deepEqual(logs.find(row => row[0] === `[MediRef] DOB ${part}_selection_safety`)![1],
              { activeElementIsPart: false, selectionInsidePart: true });
          }
          const year = page.locator('[data-segment="year"]');
          assert.equal(await year.getAttribute("data-insertions"), "1");
          assert.equal(await year.getAttribute("data-insert-length"), "4");
          assert.deepEqual(await page.locator('[data-segment]').allTextContents(), ["09", "06", "1990"]);
          assert.equal(await page.locator("button").evaluate(element => element === document.activeElement), true);
          let previous = -1;
          for (const phase of ["year_selection_resolve_started", "year_selection_started", "year_selectText_completed",
            "year_selection_inspection_started", "year_selection_inspection", "year_selection_safety",
            "year_single_insert_started", "year_single_insert_completed", "year_after_insert_focus", "year_verify", "year_post_blur_verify", "final verification completed"]) {
            const index = logs.findIndex(row => row[0] === `[MediRef] DOB ${phase}`);
            assert.ok(index > previous, phase); previous = index;
          }
        }
        if (mode === "revert") assert.equal((logs.at(-1)?.[1] as { operation: string }).operation, "year_post_blur_verify");
        assert.ok(!JSON.stringify(logs).includes("1990"));
      });
    }
    for (const mode of ["auto", "tab", "focus-lost-after-write", "wrong-target", "unavailable", "committed-wrong-target", "bad-month-commit", "single-insert", "ignored-day-insert", "ignored-month-insert", "conflicting-day"]) {
      const advance = mode === "auto";
      await t.test(`custom segments with ineffective year focus: ${mode}`, async () => {
        await page.setContent(`<div data-date-field-input>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" tabindex="0" data-segment="year" aria-valuenow="2001">2001</span>
        </div><button>Next</button>`);
        await page.locator('[data-date-field-input]').evaluate((group, advance) => {
          const day = group.querySelector<HTMLElement>('[data-segment="day"]')!;
          const month = group.querySelector<HTMLElement>('[data-segment="month"]')!;
          const year = group.querySelector<HTMLElement>('[data-segment="year"]')!;
          // Component accepts keyboard navigation but redirects independent focus attempts.
          const nativeFocus = HTMLElement.prototype.focus;
          let navigationAllowed = false;
          month.addEventListener("keydown", event => {
            if (event.key === "Tab" && !event.shiftKey) navigationAllowed = true;
          });
          year.addEventListener("focus", () => {
            if (!navigationAllowed) {
              year.setAttribute("data-focus-attempts", String(Number(year.getAttribute("data-focus-attempts") || 0) + 1));
              nativeFocus.call(document.querySelector("button"));
            }
            navigationAllowed = false;
          });
          for (const field of [day, month, year]) {
            let digits = 0;
            field.addEventListener("focus", () => { digits = 0; });
            field.addEventListener("input", () => {
              field.setAttribute("aria-valuenow", String(Number(field.textContent)));
              digits++;
              if (advance && field.textContent?.length === 2 && field !== year) {
                if (field === month) navigationAllowed = true;
                nativeFocus.call(field === day ? month : year);
              }
            });
          }
        }, advance);
        const year = page.locator('[data-segment="year"]');
        await year.focus();
        assert.equal(await year.evaluate(element => document.activeElement === element), false);
        // Native Tab navigation works in this explicit fixture, without calling year.focus().
        await page.locator('[data-segment="month"]').focus();
        await page.keyboard.press("Tab");
        assert.equal(await year.evaluate(element => document.activeElement === element), true);
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.locator('[data-segment="month"]').evaluate(element => document.activeElement === element), true);
        await page.locator("button").focus();
        if (mode === "tab") {
          await year.evaluate(element => {
            const overlay = document.createElement("div"); const bounds = element.getBoundingClientRect();
            Object.assign(overlay.style, { position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`,
              width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: "9999" });
            document.body.append(overlay);
          });
          await assert.rejects(year.click({ timeout: 300 }), /intercepts pointer events/);
        }
        await page.locator('[data-segment="month"]').evaluate((month, mode) => {
          if (mode === "focus-lost-after-write") {
            month.addEventListener("input", () => {
              if (month.textContent?.length === 2) document.querySelector("button")!.focus();
            });
          }
          // Provisional numeric state agrees after insertion; blur may still reject it.
          month.addEventListener("blur", () => month.setAttribute("aria-valuenow", mode === "bad-month-commit" ? "12" : String(Number(month.textContent))));
          month.addEventListener("keydown", event => {
            const key = event as KeyboardEvent;
            if (key.key === "Tab" && (mode === "wrong-target" || mode === "unavailable" || mode === "committed-wrong-target")) {
              key.preventDefault();
              if (mode === "committed-wrong-target") month.setAttribute("aria-valuenow", String(Number(month.textContent)));
              if (mode === "wrong-target" || mode === "committed-wrong-target") document.querySelector("button")!.focus();
            }
          });
        }, mode);
        await page.locator('[data-segment="day"], [data-segment="month"]').evaluateAll((fields, mode) => {
          for (const field of fields) {
            field.addEventListener("keydown", event => {
              if (/^\d$/.test((event as KeyboardEvent).key)) {
                field.setAttribute("data-digit-keys", String(Number(field.getAttribute("data-digit-keys") || 0) + 1));
                if (mode === "single-insert") {
                  event.preventDefault(); document.querySelector("button")!.focus();
                }
              }
            });
            field.addEventListener("beforeinput", event => {
              const input = event as InputEvent;
              field.setAttribute("data-insertion-length", String(input.data?.length || 0));
              if (mode === `ignored-${field.getAttribute("data-segment")}-insert`) event.preventDefault();
            });
            if (mode === "conflicting-day" && field.getAttribute("data-segment") === "day") {
              field.addEventListener("input", () => field.setAttribute("aria-valuenow", "31"));
            }
          }
        }, mode);
        if (mode === "single-insert") {
          const month = page.locator('[data-segment="month"]');
          await month.selectText(); await month.pressSequentially("06");
          assert.equal(await page.locator("button").evaluate(element => document.activeElement === element), true);
          await month.evaluate(element => element.removeAttribute("data-digit-keys"));
        }
        const shouldSucceed = ["tab", "auto", "single-insert", "focus-lost-after-write", "wrong-target", "unavailable", "committed-wrong-target"].includes(mode);
        const logs: unknown[][] = [];
        const originalLog = console.log; const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          if (shouldSucceed) assert.equal(await enter(), true);
          else await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
        } finally { console.log = originalLog; console.warn = originalWarn; }
        if (shouldSucceed) {
          assert.equal(await year.getAttribute("aria-valuenow"), "1990");
          assert.ok(logs.some(entry => entry[0] === "[MediRef] DOB year_single_insert_completed"));
          assert.ok(!logs.some(entry => entry[0] === "[MediRef] DOB month_pre_navigation_focus"));
        } else {
          assert.equal(await year.getAttribute("aria-valuenow"), "2001");
          assert.ok(!logs.some(entry => entry[0] === "[MediRef] DOB year_single_insert_started"));
        }
        if (mode === "single-insert") {
          for (const part of ["day", "month"]) {
            const field = page.locator(`[data-segment="${part}"]`);
            assert.equal(await field.getAttribute("data-insertion-length"), "2");
            assert.equal(await field.getAttribute("data-digit-keys"), null);
            assert.ok(logs.some(entry => entry[0] === `[MediRef] DOB ${part}_single_insert_completed`));
          }
        }
        if (mode === "focus-lost-after-write") {
          assert.ok(logs.some(entry => entry[0] === "[MediRef] DOB final verification completed"));
          assert.ok(!logs.some(entry => entry[0] === "[MediRef] DOB year_navigation_tab_started"));
          const active = logs.find(entry => entry[0] === "[MediRef] DOB month_after_insert_focus")?.[1] as { tagName: string; matchesMonth: boolean };
          assert.equal(active.matchesMonth, false);
          if (mode === "focus-lost-after-write") assert.equal(active.tagName, "BUTTON");
        }
        assert.ok(!JSON.stringify(logs).includes("1990"));
      });
    }
    await t.test("plain contenteditable segments verify textContent without a value property", async () => {
      await page.setContent(`<div data-date-field-input>
        <span contenteditable="true" data-type="day">31</span>
        <span contenteditable="true" data-type="month">12</span>
        <span contenteditable="true" data-type="year">2001</span>
      </div><button>Next</button>`);
      assert.equal(await enter(), true);
      assert.deepEqual(await page.locator('[contenteditable]').allTextContents(), ["09", "06", "1990"]);
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
        standardEditableInputs: 0, compositeGroups: 1, candidateSegments: 1, identifiedParts: ["day"], stage: "control discovery", operation: "discover",
      }]]);
      assert.ok(!JSON.stringify(warnings).includes("private-patient-marker"));
      assert.ok(!JSON.stringify(warnings).includes("1990"));
    });
    await t.test("failure identifies month entry and never prints raw labels or DOB", async () => {
      await page.setContent(`<div data-date-field-input>
        <input aria-label="Day private-patient-marker">
        <span role="spinbutton" tabindex="0" aria-label="Month private-patient-marker" aria-valuenow="12">12</span>
        <input aria-label="Year private-patient-marker">
      </div>`);
      const logs: unknown[][] = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = (...args: unknown[]) => { logs.push(args); };
      console.warn = (...args: unknown[]) => { logs.push(args); };
      try {
        await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
      }
      const diagnostic = logs.at(-1)?.[1] as { stage: string; operation: string };
      assert.equal(diagnostic.stage, "month entry");
      assert.equal(diagnostic.operation, "clear");
      assert.ok(!JSON.stringify(logs).includes("private-patient-marker"));
      assert.ok(!JSON.stringify(logs).includes("09/06/1990"));
      assert.ok(!JSON.stringify(logs).includes("1990"));
      assert.equal(await page.getByLabel(/Year/).inputValue(), "");
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
