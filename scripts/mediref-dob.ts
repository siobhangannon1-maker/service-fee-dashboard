import type { Locator, Page } from "playwright";

const failure = "Unable to enter patient DOB in MediRef date control";
const groupSelector = '[data-testid="patient-dob-input"], [data-date-field-input], #dob[role="group"]';
const timeout = 3000;

async function readValue(field: Locator) {
  return field.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element.getAttribute("aria-valuenow") ?? element.textContent ?? "";
  });
}

function segment(group: Locator, part: string) {
  return group.getByRole("spinbutton", { name: new RegExp(`\\b${part}\\b`, "i") })
    .or(group.getByLabel(new RegExp(`^${part}\\b`, "i")))
    .or(group.locator(`[data-type="${part}"], [data-segment="${part}"]`));
}

async function usableStandard(field: Locator) {
  return await field.evaluate((element, selector) =>
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    !element.parentElement?.closest(selector), groupSelector) &&
    await field.isVisible() && await field.isEditable();
}

// Kept separate from the worker so local browser tests cannot start jobs or load credentials.
export async function enterPatientDob(page: Page, iso: string, human: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(failure);
  const values = { day: match[3], month: match[2], year: match[1] };

  const diagnostics = { standardEditableInputs: 0, compositeGroups: 0, candidateSegments: 0, identifiedParts: [] as string[] };
  try {
    const standard = page.locator([
      'input[data-testid="patient-dob-input"]',
      ...["name", "id", "placeholder", "aria-label"].flatMap((attribute) =>
        ["dob", "birth"].map((hint) => `input[${attribute}*="${hint}" i]`),
      ),
      'input[type="date"]',
    ].join(", ")).or(page.getByLabel(/date of birth|dob/i));

    // Discovery APIs do not auto-wait. Allow delayed rendering/hydration before entry.
    const deadline = Date.now() + timeout;
    let ready = false;
    do {
      diagnostics.standardEditableInputs = 0;
      diagnostics.compositeGroups = 0;
      diagnostics.candidateSegments = 0;
      diagnostics.identifiedParts = [];
      for (const field of await standard.all()) {
        if (await usableStandard(field)) diagnostics.standardEditableInputs += 1;
      }
      ready = diagnostics.standardEditableInputs > 0;
      for (const group of await page.locator(groupSelector).all()) {
        if (!await group.isVisible()) continue;
        diagnostics.compositeGroups += 1;
        diagnostics.candidateSegments += await group.locator('input, textarea, [role="spinbutton"], [contenteditable="true"]').count();
        let identified = 0;
        for (const part of ["day", "month", "year"]) {
          const field = segment(group, part);
          if (await field.count() === 1 && await field.isVisible() && await field.isEnabled()) {
            identified += 1;
            diagnostics.identifiedParts.push(part);
          }
        }
        if (identified === 3) ready = true;
      }
      if (ready) break;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    if (!ready) throw new Error(failure);

    for (const field of await standard.all()) {
      if (!await usableStandard(field)) continue;
      const value = await field.getAttribute("type") === "date" ? iso : human;
      console.log("[MediRef] Entering DOB using standard input");
      await field.fill(value, { timeout });
      await field.press("Tab", { timeout });
      if (await readValue(field) === value) return true;
      throw new Error(failure);
    }

    for (const group of await page.locator(groupSelector).all()) {
      if (!await group.isVisible()) continue;
      const fields: Partial<Record<keyof typeof values, Locator>> = {};
      for (const part of ["day", "month", "year"] as const) {
        // Resolve by explicit semantics, never by segment position or locale order.
        const field = segment(group, part);
        if (await field.count() !== 1 || !await field.isVisible()) break;
        fields[part] = field;
      }
      if (!fields.day || !fields.month || !fields.year) continue;

      console.log("[MediRef] Entering DOB using segmented date control");
      for (const part of ["day", "month", "year"] as const) {
        const field = fields[part]!;
        if (!await field.isEnabled() || await field.getAttribute("aria-readonly") === "true") {
          throw new Error(failure);
        }
        const nativeInput = await field.evaluate((element) =>
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement);
        if (nativeInput) {
          await field.fill(values[part], { timeout });
        } else {
          // Custom spinbuttons use keyboard events to update their component state.
          await field.focus({ timeout });
          await field.press("ArrowUp", { timeout });
          await field.pressSequentially(values[part], { timeout });
        }
      }
      await fields.year.press("Tab", { timeout });
      // Year need not be last in tab order. Commit on group exit before reading values.
      await group.evaluate((element) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && element.contains(active)) active.blur();
      });
      for (const part of ["day", "month", "year"] as const) {
        const actual = (await readValue(fields[part]!)).trim();
        if (!/^\d+$/.test(actual) || Number(actual) !== Number(values[part])) {
          throw new Error(failure);
        }
      }
      return true;
    }
  } catch {
    // Playwright errors can include entered values and DOM text; keep patient data out of logs.
    console.warn("[MediRef] DOB control entry failed", diagnostics);
    throw new Error(failure);
  }
  console.warn("[MediRef] DOB control entry failed", diagnostics);
  throw new Error(failure);
}
