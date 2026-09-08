import type { Locator, Page } from "playwright";

const failure = "Unable to enter patient DOB in MediRef date control";
const groupSelector = '[data-testid="patient-dob-input"], [data-date-field-input], #dob[role="group"]';
const timeout = 3000;

async function readValue(field: Locator) {
  return field.evaluate((element) => {
    if (element.getAttribute("data-placeholder") === "true") return "";
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element.getAttribute("aria-valuenow") ?? element.textContent ?? "";
  });
}

async function segmentStructure(field: Locator, part: string) {
  const structure = await field.evaluate((element) => {
    const native = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const contentEditable = element.getAttribute("contenteditable");
    const dataType = element.getAttribute("data-type");
    const dataSegment = element.getAttribute("data-segment");
    const role = element.getAttribute("role");
    const type = element.getAttribute("type");
    return {
      tagName: element.tagName,
      role: role === null ? null : ["spinbutton", "textbox"].includes(role) ? role : "other",
      inputType: type === null ? null : ["text", "date", "number", "tel", "hidden"].includes(type) ? type : "other",
      contentEditable: contentEditable === null ? null :
        ["", "true", "false", "plaintext-only"].includes(contentEditable) ? contentEditable : "other",
      isContentEditable: element instanceof HTMLElement && element.isContentEditable,
      dataType: dataType === null ? null : ["day", "month", "year"].includes(dataType) ? dataType : "other",
      dataSegment: dataSegment === null ? null : ["day", "month", "year"].includes(dataSegment) ? dataSegment : "other",
      hasValueProperty: "value" in element,
      hasAriaValueNow: element.hasAttribute("aria-valuenow"),
      hasAriaValueText: element.hasAttribute("aria-valuetext"),
      hasTextContent: Boolean(element.textContent?.trim()),
      stateSource: native ? "value" : element.hasAttribute("aria-valuenow") ? "aria-valuenow" :
        element.hasAttribute("aria-valuetext") ? "aria-valuetext" : "textContent",
      placeholder: element.getAttribute("data-placeholder") === "true",
      readOnly: element.getAttribute("aria-readonly") === "true" || (native && element.readOnly),
      native,
    };
  });
  // Do not emit raw accessible labels: they can include patient information.
  return { part, ...structure, visible: await field.isVisible(), disabled: !await field.isEnabled() };
}

function numericSegment(value: string) {
  // Some date components include bidi formatting marks in their displayed text.
  const clean = value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return /^\d+$/.test(clean) ? Number(clean) : null;
}

async function segmentMatches(field: Locator, expected: string) {
  const sources = await field.evaluate((element) => {
    if (element.getAttribute("data-placeholder") === "true") return [];
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return [element.value];
    return [element.getAttribute("aria-valuenow"), element.getAttribute("aria-valuetext"), element.textContent];
  });
  // Only whole numeric parts are meaningful here; never extract a number from descriptive text.
  // Conflicting numeric sources must not pass merely because the editable DOM looks correct.
  const numeric = sources.filter((value): value is string => value !== null).map(numericSegment)
    .filter((value): value is number => value !== null);
  return numeric.length > 0 && numeric.every((value) => value === Number(expected));
}

async function observeYear(field: Locator, phase: string, previous?: Array<string | null>) {
  const state = await field.evaluate((element) => [
    element.getAttribute("aria-valuenow"), element.getAttribute("aria-valuetext"), element.textContent,
  ]);
  const numeric = state.filter((value): value is string => value !== null).map(numericSegment)
    .filter((value): value is number => value !== null);
  console.log("[MediRef] DOB year state", {
    part: "year", phase,
    hasAriaValueNow: state[0] !== null, hasAriaValueText: state[1] !== null, hasTextContent: Boolean(state[2]?.trim()),
    numericSourcesAgree: numeric.length > 1 ? new Set(numeric).size === 1 : null,
    changedSincePrevious: previous ? state.some((value, index) => value !== previous[index]) : null,
  });
  return state;
}

async function waitForSegment(field: Locator, expected: string) {
  const deadline = Date.now() + timeout;
  do {
    if (await segmentMatches(field, expected)) return;
    await field.page().waitForTimeout(50);
  } while (Date.now() < deadline);
  throw new Error(failure);
}

async function waitForPersistedDate(group: Locator, values: Record<string, string>) {
  const deadline = Date.now() + timeout;
  let matchingSince: number | null = null;
  do {
    let matches = true;
    for (const part of ["day", "month", "year"]) {
      // Locators resolve the current DOM on every read, including replacement segments after blur.
      const field = segment(group, part);
      if (await field.count() !== 1 || !await field.isVisible() || !await segmentMatches(field, values[part])) matches = false;
    }
    matchingSince = matches ? matchingSince ?? Date.now() : null;
    if (matchingSince !== null && Date.now() - matchingSince >= 250) return;
    await group.page().waitForTimeout(50);
  } while (Date.now() < deadline);
  throw new Error(failure);
}

async function replaceCustomSegment(field: Locator, contentEditable: boolean) {
  await field.focus({ timeout });
  // Date segments may delete one digit per Backspace and move focus when already empty.
  // Check after each deletion and stop before pressing Backspace on a placeholder.
  for (let count = 0; count < 4; count += 1) {
    const before = await readValue(field);
    if (numericSegment(before) === null) return;
    if (contentEditable) await field.press("ControlOrMeta+A", { timeout });
    await field.press("Backspace", { timeout });
    const deadline = Date.now() + timeout;
    while (await readValue(field) === before && Date.now() < deadline) {
      await field.page().waitForTimeout(50);
    }
    if (await readValue(field) === before) throw new Error(failure);
  }
  if (numericSegment(await readValue(field)) !== null) throw new Error(failure);
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

  let stage = "control discovery";
  let operation = "discover";
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
      stage = "standard entry";
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
        stage = `${part} entry`;
        operation = "inspect";
        const field = fields[part]!;
        const structure = await segmentStructure(field, part);
        console.log("[MediRef] DOB segment structure", structure);
        if (structure.disabled || structure.readOnly) throw new Error(failure);
        const customYear = part === "year" && structure.isContentEditable && structure.role === "spinbutton";
        let yearState = customYear ? await observeYear(field, "before write") : undefined;
        operation = "write";
        if (structure.native) {
          await field.fill(values[part], { timeout });
        } else {
          if (!structure.isContentEditable && structure.role !== "spinbutton") throw new Error(failure);
          if (structure.isContentEditable) {
            operation = "select";
            await field.focus({ timeout });
            // Replace selected content through keyboard events; custom segments may never be blank.
            await field.selectText({ timeout });
          } else {
            operation = "clear";
            await replaceCustomSegment(field, false);
            await field.focus({ timeout });
          }
          operation = "write";
          await field.pressSequentially(values[part], { timeout });
          if (customYear) yearState = await observeYear(field, "after sequential write", yearState);
          if (structure.isContentEditable) {
            operation = "commit";
            await field.blur({ timeout });
            if (customYear) yearState = await observeYear(field, "after blur", yearState);
          }
        }
        operation = "verify";
        try {
          await waitForSegment(field, values[part]);
        } catch {
          if (!customYear) throw new Error(failure);
          yearState = await observeYear(field, "sequential verification failed", yearState);
          // Some year segments normalise each keystroke. Retry only the year as one browser insertion.
          operation = "select full year";
          await field.focus({ timeout });
          await field.selectText({ timeout });
          if (!await field.evaluate((element) => element === document.activeElement)) throw new Error(failure);
          operation = "write full year";
          await page.keyboard.insertText(values.year);
          yearState = await observeYear(field, "after full year insertion", yearState);
          operation = "commit full year";
          await field.blur({ timeout });
          yearState = await observeYear(field, "after full year blur", yearState);
          operation = "verify full year";
          try {
            await waitForSegment(field, values.year);
          } finally {
            await observeYear(field, "full year verification finished", yearState);
          }
        }
        console.log("[MediRef] DOB segment verified", { part });
      }
      stage = "final verification";
      operation = "leave control";
      await fields.year.press("Tab", { timeout });
      // Year need not be last in tab order. Commit on group exit before reading values.
      await group.evaluate((element) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && element.contains(active)) active.blur();
      });
      operation = "verify persistence";
      await waitForPersistedDate(group, values);
      console.log("[MediRef] DOB final verification completed");
      return true;
    }
  } catch {
    // Playwright errors can include entered values and DOM text; keep patient data out of logs.
    console.warn("[MediRef] DOB control entry failed", { ...diagnostics, stage, operation });
    throw new Error(failure);
  }
  console.warn("[MediRef] DOB control entry failed", { ...diagnostics, stage, operation });
  throw new Error(failure);
}
