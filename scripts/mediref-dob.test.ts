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
                (elements[index + 1] as HTMLElement | undefined)?.focus();
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
        field.addEventListener("blur", () => field.setAttribute("aria-valuetext", field.textContent || ""));
      });
      assert.equal(await enter(), true);
      await page.locator('[data-segment="day"]').evaluate((field) => field.setAttribute("aria-valuenow", "31"));
      await assert.rejects(enter, { message: "Unable to enter patient DOB in MediRef date control" });
    });
    for (const mode of ["success", "ignored", "revert", "unsafe-selection", "replace-on-focus", "blocked-click", "unsafe-focus"] as const) {
      await t.test(`keyboard-only year replacement: ${mode}`, async () => {
        await page.setContent(`<p>Outside selection sentinel</p><div data-date-field-input>
          <span role="spinbutton" contenteditable="true" data-segment="day" aria-valuenow="31">31</span>
          <span role="spinbutton" contenteditable="true" data-segment="month" aria-valuenow="12">12</span>
          <span role="spinbutton" contenteditable="true" data-segment="year" tabindex="0" inputmode="numeric"
            aria-valuemin="1" aria-valuemax="9999" aria-valuenow="2001" aria-valuetext="2001">2001</span>
        </div><button>Next</button>`);
        await page.locator('[data-segment]').evaluateAll((elements, mode) => {
          for (const element of elements) {
            if (element.getAttribute("data-segment") !== "year") {
              element.addEventListener("input", () => element.setAttribute("aria-valuenow", String(Number(element.textContent))));
              continue;
            }
            if (mode === "replace-on-focus") {
              element.addEventListener("focus", () => element.replaceWith(element.cloneNode(true)), { once: true });
            }
            let selectedByKeyboard = false;
            let digits = "";
            element.addEventListener("beforeinput", event => event.preventDefault());
            element.addEventListener("keydown", event => {
              const key = event as KeyboardEvent;
              if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === "a") {
                selectedByKeyboard = true;
                if (mode === "unsafe-selection") {
                  key.preventDefault();
                  const range = document.createRange(); range.selectNodeContents(document.body);
                  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
                }
              }
              if (!/^\d$/.test(key.key)) return;
              key.preventDefault();
              if (!selectedByKeyboard || mode === "ignored") return;
              if (!digits && document.getSelection()?.toString() !== element.textContent) return;
              digits += key.key;
              element.setAttribute("data-digit-keys", String(digits.length));
              element.textContent = digits;
              element.setAttribute("aria-valuenow", String(Number(digits)));
              element.setAttribute("aria-valuetext", String(Number(digits)));
            });
            element.addEventListener("blur", () => {
              if (mode === "revert") setTimeout(() => {
                element.textContent = "2001";
                element.setAttribute("aria-valuenow", "2001");
                element.setAttribute("aria-valuetext", "2001");
              }, 100);
            });
          }
        }, mode);
        const year = page.locator('[data-segment="year"]');
        if (mode === "blocked-click") {
          await year.evaluate(element => {
            const overlay = document.createElement("div");
            const bounds = element.getBoundingClientRect();
            Object.assign(overlay.style, { position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`,
              width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: "9999" });
            document.body.append(overlay);
          });
          await assert.rejects(year.click({ timeout: 300 }), /intercepts pointer events/);
        }
        // DOM selection alone does not activate this fixture's keyboard replacement mode.
        if (mode !== "replace-on-focus") {
          await year.selectText();
          await year.pressSequentially("1958");
        }
        if (mode === "unsafe-focus") {
          await year.blur();
          await year.evaluate(element => element.addEventListener("focus", () => document.querySelector("button")!.focus()));
        }
        assert.equal(await year.getAttribute("aria-valuenow"), "2001");
        const logs: unknown[][] = [];
        const originalLog = console.log;
        const originalWarn = console.warn;
        console.log = (...args: unknown[]) => { logs.push(args); };
        console.warn = (...args: unknown[]) => { logs.push(args); };
        try {
          const enterYear = () => enterPatientDob(page, "1958-05-09", "09/05/1958");
          if ((mode === "success" || mode === "blocked-click")) assert.equal(await enterYear(), true);
          else await assert.rejects(enterYear, { message: "Unable to enter patient DOB in MediRef date control" });
        } finally { console.log = originalLog; console.warn = originalWarn; }
        if ((mode === "success" || mode === "blocked-click")) {
          assert.equal(await year.getAttribute("aria-valuenow"), "1958");
          assert.equal(await year.getAttribute("data-digit-keys"), "4");
          assert.ok(logs.some(entry => entry[0] === "[MediRef] DOB final verification completed"));
        }
        if ((mode === "success" || mode === "blocked-click")) {
          const phases = logs.map(entry => entry[0]);
          let previous = -1;
          for (const phase of ["year_resolve_started", "year_resolved", "year_focus_attempt_started", "year_focus_attempt_completed",
            "year_active_element_verified", "year_select_all_started", "year_select_all_sent",
            "year_selection_inspection_started", "year_selection_verified", "year_write_started", "year_write_completed",
            "year_verify", "year_post_blur_verify"]) {
            const index = phases.indexOf(`[MediRef] DOB ${phase}`);
            assert.ok(index > previous, phase); previous = index;
          }
        }
        if (mode === "replace-on-focus") {
          assert.deepEqual(logs.find(entry => entry[0] === "[MediRef] DOB year_focus")?.[1], {
            activeElementIsYear: false, nodeChangedAfterFocus: true, originalNodeDetached: true, activeElementChanged: false,
          });
          assert.equal((logs.at(-1)?.[1] as { operation: string }).operation, "year_focus_inspection");
        }
        if (mode === "unsafe-focus") {
          assert.equal((logs.at(-1)?.[1] as { operation: string }).operation, "year_focus_inspection");
          assert.ok(!logs.some(entry => entry[0] === "[MediRef] DOB year_select_all_started"));
        }
        if (mode === "unsafe-selection") {
          const selection = logs.find(entry => entry[0] === "[MediRef] DOB year_selection")?.[1] as Record<string, unknown>;
          assert.equal(selection.rangeInsideYear, false);
          assert.equal(selection.selectionExists, true);
          assert.equal(selection.rangeCount, 1);
          assert.equal((logs.at(-1)?.[1] as { operation: string }).operation, "year_selection_inspection_started");
          assert.equal(await year.getAttribute("data-digit-keys"), null);
          assert.equal(await page.locator("p").textContent(), "Outside selection sentinel");
        }
        assert.ok(!JSON.stringify(logs).includes("1958"));
        assert.ok(logs.some(entry => entry[0] === "[MediRef] DOB year_focus"));
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
