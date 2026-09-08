import type { Locator, Page } from "playwright";

export const MEDIREF_DOB_IMPLEMENTATION_VERSION = "dob-v2026-09-08-diagnostics-1";

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
      ...(element.getAttribute("data-segment") === "year" || element.getAttribute("data-type") === "year" ? {
        hasTabIndex: element.hasAttribute("tabindex"),
        inputMode: ["numeric", "decimal", "text", "none"].includes(element.getAttribute("inputmode") || "") ? element.getAttribute("inputmode") : null,
        hasAriaValueMin: element.hasAttribute("aria-valuemin"),
        hasAriaValueMax: element.hasAttribute("aria-valuemax"),
      } : {}),
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

type YearState = { sources: Array<string | null>; min: string | null; max: string | null; placeholder: boolean };

// Only classifications leave this function; raw state stays private to verification.
export function classifyYearState(state: YearState, expected: string) {
  const minimum = numericSegment(state.min ?? "");
  const maximum = numericSegment(state.max ?? "");
  const classify = (value: string | null) => {
    const number = numericSegment(value ?? "");
    const clean = (value ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
    const digits = number === null ? 0 : clean.length;
    return {
      sourcePresent: value !== null, numericParseable: number !== null,
      digitCount: digits > 4 ? ">4" : digits,
      matchesExpected: number !== null && number === Number(expected),
      matchesExpectedLast2Digits: number !== null && number === Number(expected.slice(-2)),
      matchesExpectedFirst2Digits: number !== null && number === Number(expected.slice(0, 2)),
      withinAriaMinMax: number === null || minimum === null || maximum === null || minimum > maximum ? null : number >= minimum && number <= maximum,
    };
  };
  const numeric = state.sources.map(value => numericSegment(value ?? "")).filter((value): value is number => value !== null);
  return {
    ariaValueNow: classify(state.sources[0] ?? null), ariaValueText: classify(state.sources[1] ?? null),
    textContent: classify(state.sources[2] ?? null),
    numericSourcesAgree: numeric.length < 2 ? null : numeric.every(value => value === numeric[0]),
    allExpected: !state.placeholder && numeric.length > 0 && numeric.every(value => value === Number(expected)),
    anyExpected: !state.placeholder && numeric.some(value => value === Number(expected)),
  };
}

function yearStateDiagnostics(expected: string, phase = "year") {
  let previous: YearState | undefined;
  let initial: ReturnType<typeof classifyYearState> | undefined;
  let samples = 0;
  let stateChangedAfterInitialSample = false;
  let expectedStateAppearedLater = false;
  let sourcesConverged = false;
  let observedDisagreement = false;
  let everExpected = false;
  return {
    observe(state: YearState) {
      const classification = classifyYearState(state, expected);
      const changed = previous !== undefined && (state.placeholder !== previous.placeholder || state.sources.some((value, i) => value !== previous!.sources[i]));
      samples++;
      stateChangedAfterInitialSample ||= changed;
      expectedStateAppearedLater ||= Boolean(initial && !initial.allExpected && classification.allExpected);
      sourcesConverged ||= observedDisagreement && classification.numericSourcesAgree === true;
      observedDisagreement ||= classification.numericSourcesAgree === false;
      everExpected ||= classification.allExpected;
      if (!previous || changed) console.log(`[MediRef] DOB ${phase}_state_sample`, { phase: previous ? "changed" : "initial", ...classification });
      initial ??= classification;
      previous = state;
    },
    finish() {
      console.log(`[MediRef] DOB ${phase}_state_verification`, {
        samples, stateChangedAfterInitialSample, expectedStateAppearedLater, sourcesConverged,
        remainedNonmatching: samples > 0 && !everExpected,
      });
    },
  };
}

async function segmentMatches(field: Locator, expected: string, observe?: (state: YearState) => void) {
  const state = await field.evaluate((element, diagnostic) => {
    const placeholder = element.getAttribute("data-placeholder") === "true";
    const native = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const sources = native ? [element.value] : [element.getAttribute("aria-valuenow"), element.getAttribute("aria-valuetext"), element.textContent];
    return { sources, placeholder, min: diagnostic ? element.getAttribute("aria-valuemin") : null, max: diagnostic ? element.getAttribute("aria-valuemax") : null };
  }, Boolean(observe));
  observe?.(state);
  const sources = state.placeholder ? [] : state.sources;
  // Only whole numeric parts are meaningful here; never extract a number from descriptive text.
  // Conflicting numeric sources must not pass merely because the editable DOM looks correct.
  const numeric = sources.filter((value): value is string => value !== null).map(numericSegment)
    .filter((value): value is number => value !== null);
  return numeric.length > 0 && numeric.every((value) => value === Number(expected));
}

async function waitForSegment(field: Locator, expected: string, observe?: (state: YearState) => void) {
  const deadline = Date.now() + timeout;
  do {
    if (await segmentMatches(field, expected, observe)) return;
    await field.page().waitForTimeout(50);
  } while (Date.now() < deadline);
  throw new Error(failure);
}

// Only semantic custom contenteditable year spinbuttons use visible text as canonical.
async function customYearMatches(field: Locator, expected: string) {
  if (await field.count() !== 1 || !await field.isVisible() || !await field.isEnabled() || !await field.isEditable()) return false;
  const valid = await field.evaluate(element => element.isConnected && element instanceof HTMLElement &&
    !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) &&
    element.isContentEditable && element.getAttribute("role") === "spinbutton" &&
    element.getAttribute("aria-readonly") !== "true" && element.getAttribute("aria-disabled") !== "true" &&
    element.getAttribute("data-placeholder") !== "true");
  const text = (await field.textContent() ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return valid && /^\d{4}$/.test(text) && Number(text) === Number(expected);
}

async function waitForPersistedDate(group: Locator, values: Record<string, string>, inspectYear?: (year: Locator) => Promise<boolean>) {
  const deadline = Date.now() + timeout;
  let matchingSince: number | null = null;
  do {
    let matches = true;
    for (const part of ["day", "month", "year"]) {
      // Locators resolve the current DOM on every read, including replacement segments after blur.
      const field = segment(group, part);
      if (await field.count() !== 1 || !await field.isVisible()) { matches = false; continue; }
      if (part === "year" && inspectYear) {
        if (!await inspectYear(field)) matches = false;
      } else if (!await segmentMatches(field, values[part])) matches = false;
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

async function logActiveSegment(group: Locator, phase: string, navigation = false) {
  const matches: Record<string, boolean> = {};
  for (const part of ["day", "month", "year"]) {
    const field = segment(group, part);
    matches[part] = await field.count() === 1 && await field.evaluate(element => element === document.activeElement);
  }
  const structure = await group.evaluate(element => {
    const active = document.activeElement;
    const role = active?.getAttribute("role");
    const part = active?.getAttribute("data-segment");
    return {
      tagName: active?.tagName ?? null,
      role: role == null ? null : ["spinbutton", "textbox", "group", "button"].includes(role) ? role : "other",
      dataSegment: part == null ? null : ["day", "month", "year"].includes(part) ? part : "other",
      contentEditable: active instanceof HTMLElement && active.isContentEditable,
      insideDobGroup: Boolean(active && element.contains(active)),
    };
  });
  console.log(`[MediRef] DOB ${phase}`, { ...structure, ...(navigation ? { matchesDay: matches.day, matchesMonth: matches.month, matchesYear: matches.year } : { matches }) });
}

async function insertCustomPart(group: Locator, part: "day" | "month" | "year", expected: string, step: (operation: string) => void, dobValues?: Record<string, string>) {
  const field = segment(group, part);
  const selectionStep = (operation: string) => {
    step(`${part}_${operation}`);
    console.log(`[MediRef] DOB ${part}_${operation}`);
  };
  selectionStep("selection_resolve_started");
  const original = await field.elementHandle({ timeout });
  try {
    const parts = ["day", "month", "year"] as const;
    const snapshot = () => Promise.all(parts.map(name => segment(group, name).evaluate(element => [
      element.getAttribute("aria-valuenow"), element.getAttribute("aria-valuetext"), element.textContent,
    ])));
    let before: Array<Array<string | null>>;
    if (part !== "year") {
      selectionStep("selection_focus_started");
      await field.focus({ timeout });
    }
    selectionStep("selection_started");
    await field.selectText({ timeout });
    selectionStep("selectText_completed");
    selectionStep("selection_inspection_started");
    const visible = await field.isVisible();
    const editable = await field.isEditable();
    const enabled = await field.isEnabled();
    before = await snapshot();
    const inspection = await field.evaluate((element, { original, groupSelector }) => {
      const selection = document.getSelection();
      const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      const rangeInside = Boolean(range && element.contains(range.startContainer) && element.contains(range.endContainer));
      const active = document.activeElement === element;
      return {
        active, selectionExists: Boolean(selection), rangeCount: selection?.rangeCount ?? 0,
        anchorInside: Boolean(selection?.anchorNode && element.contains(selection.anchorNode)),
        focusInside: Boolean(selection?.focusNode && element.contains(selection.focusNode)), rangeInside,
        nodeDetached: !original?.isConnected, nodeChanged: original !== element,
        insideDobGroup: Boolean(element.closest(groupSelector)?.contains(document.activeElement)),
        editable: element instanceof HTMLElement && element.isContentEditable &&
          element.getAttribute("role") === "spinbutton" && element.getAttribute("aria-readonly") !== "true" &&
          element.getAttribute("aria-disabled") !== "true",
        // Keep a single fully contained range; do not accept parent-boundary selections.
        fullSelection: Boolean(rangeInside && !selection!.isCollapsed && selection!.toString() === element.textContent),
      };
    }, { original, groupSelector });
    step(`${part}_selection_inspection`);
    const name = part === "day" ? "Day" : part === "month" ? "Month" : "Year";
    console.log(`[MediRef] DOB ${part}_selection_inspection`, {
      [`activeElementIs${name}`]: inspection.active,
      selectionExists: inspection.selectionExists, rangeCount: inspection.rangeCount,
      [`anchorInside${name}`]: inspection.anchorInside, [`focusInside${name}`]: inspection.focusInside,
      [`rangeInside${name}`]: inspection.rangeInside,
      nodeDetached: inspection.nodeDetached, nodeChanged: inspection.nodeChanged, insideDobGroup: inspection.insideDobGroup,
    });
    const selectionInsidePart = inspection.selectionExists && inspection.rangeCount === 1 &&
      inspection.anchorInside && inspection.focusInside && inspection.rangeInside && inspection.fullSelection;
    console.log(`[MediRef] DOB ${part}_selection_safety`, { activeElementIsPart: inspection.active, selectionInsidePart });
    if (!selectionInsidePart || inspection.nodeDetached || inspection.nodeChanged || !visible || !editable || !enabled || !inspection.editable) {
      step(`${part}_selection_safety_validation`);
      throw new Error(failure);
    }
    step(`${part}_single_insert_started`);
    console.log(`[MediRef] DOB ${part}_single_insert_started`);
    await field.page().keyboard.insertText(expected);
    step(`${part}_single_insert_completed`);
    // Re-resolve every segment after insertion. Never infer acceptance from browser focus.
    const index = parts.indexOf(part);
    const otherPartsUnchanged = (states: Array<Array<string | null>>) => states.every((sources, i) =>
      i === index || sources.every((value, j) => value === before[i][j]));
    let after = await snapshot();
    if (!otherPartsUnchanged(after)) {
      step(`${part}_other_segment_verification`);
      throw new Error(failure);
    }
    const provisionalMatch = async () => {
      if (part !== "year" || !dobValues) return false;
      const stableEditable = await field.evaluate((element, original) => element === original && element.isConnected &&
        element instanceof HTMLElement && element.isContentEditable && element.getAttribute("role") === "spinbutton" &&
        element.getAttribute("aria-readonly") !== "true" && element.getAttribute("aria-disabled") !== "true" &&
        element.getAttribute("data-placeholder") !== "true", original);
      const text = (await field.textContent() ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
      const state = await snapshot();
      return stableEditable && /^\d{4}$/.test(text) && Number(text) === Number(expected) &&
        await field.isVisible() && await field.isEditable() && await field.isEnabled() &&
        state[index].some((value, j) => numericSegment(value ?? "") !== numericSegment(before[index][j] ?? "")) &&
        otherPartsUnchanged(state) && await segmentMatches(segment(group, "day"), dobValues.day) &&
        await segmentMatches(segment(group, "month"), dobValues.month);
    };
    let provisionalYearVisibleMatch = false;
    step(`${part}_insert_state_verification`);
    const yearDiagnostics = part === "year" ? yearStateDiagnostics(expected) : undefined;
    try {
      // Read immediately, allowing only the existing bounded wait for asynchronously
      // published semantic state. Only a safely verified provisional year may
      // carry an ARIA conflict forward to the explicit commit test.
      await waitForSegment(segment(group, part), expected, yearDiagnostics?.observe);
    } catch (error) {
      provisionalYearVisibleMatch = await provisionalMatch();
      if (!provisionalYearVisibleMatch) throw error;
    } finally {
      yearDiagnostics?.finish();
      after = await snapshot();
      console.log(`[MediRef] DOB ${part}_single_insert_completed`, {
        activeElementIsPart: await segment(group, part).evaluate(element => document.activeElement === element),
        stateChangedAfterInsert: after[index].some((value, j) => numericSegment(value ?? "") !== numericSegment(before[index][j] ?? "")),
        expectedStateObserved: await segmentMatches(segment(group, part), expected),
      });
    }
    const stateChanged = after[index].some((value, j) => numericSegment(value ?? "") !== numericSegment(before[index][j] ?? ""));
    if (part === "year") {
      const text = (after[index][2] ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
      if (!/^\d{4}$/.test(text) || Number(text) !== Number(expected)) throw new Error(failure);
    }
    if (provisionalYearVisibleMatch) {
      provisionalYearVisibleMatch = await provisionalMatch();
      console.log("[MediRef] DOB year_provisional_acceptance", { provisionalYearVisibleMatch });
      if (!provisionalYearVisibleMatch) throw new Error(failure);
    }
    if (!otherPartsUnchanged(after) || !stateChanged || (!provisionalYearVisibleMatch && !await segmentMatches(segment(group, part), expected))) throw new Error(failure);
    step(`${part}_after_insert_focus`);
    await logActiveSegment(group, `${part}_after_insert_focus`, true);
  } finally { await original?.dispose(); }
}

async function commitAndVerifyYear(group: Locator, values: Record<string, string>) {
  let before: YearState | undefined;
  await segmentMatches(segment(group, "year"), values.year, state => { before = state; });
  await segment(group, "year").blur({ timeout });
  const diagnostics = yearStateDiagnostics(values.year, "year_post_blur");
  let textPersisted = true;
  let otherPartsStayedCorrect = true;
  let last: ReturnType<typeof classifyYearState> | undefined;
  let stateChanged = false;
  try {
    await waitForPersistedDate(group, values, async year => {
      let state: YearState | undefined;
      await segmentMatches(year, values.year, observed => { state = observed; diagnostics.observe(observed); });
      last = classifyYearState(state!, values.year);
      textPersisted &&= last.textContent.matchesExpected && last.textContent.digitCount === 4;
      stateChanged ||= state!.sources.some((value, i) => value !== before!.sources[i]);
      otherPartsStayedCorrect &&= await segmentMatches(segment(group, "day"), values.day) && await segmentMatches(segment(group, "month"), values.month);
      return textPersisted && otherPartsStayedCorrect && await customYearMatches(year, values.year);
    });
  } finally {
    diagnostics.finish();
    console.log("[MediRef] DOB year_post_blur_classification", {
      year_post_blur_text_matches_expected: last?.textContent.matchesExpected ?? false,
      year_post_blur_aria_now_matches_expected: last?.ariaValueNow.matchesExpected ?? false,
      year_post_blur_sources_agree: last?.numericSourcesAgree ?? null,
      year_post_blur_visible_value_persisted: textPersisted && Boolean(last),
      year_post_blur_state_changed: stateChanged,
      yearAriaStateDiffersFromVisible: Boolean(last?.textContent.matchesExpected && last.ariaValueNow.sourcePresent && !last.ariaValueNow.matchesExpected),
    });
  }
}

async function usableStandard(field: Locator) {
  return await field.evaluate((element, selector) =>
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    !element.parentElement?.closest(selector), groupSelector) &&
    await field.isVisible() && await field.isEditable();
}

// Kept separate from the worker so local browser tests cannot start jobs or load credentials.
export async function enterPatientDob(page: Page, iso: string, human: string) {
  console.log(`[MediRef] enterPatientDob implementation: ${MEDIREF_DOB_IMPLEMENTATION_VERSION}`);
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

      const keyboardYear = await fields.year.evaluate(element => element instanceof HTMLElement && element.isContentEditable && element.getAttribute("role") === "spinbutton");
      let usedCustomYear = false;
      console.log("[MediRef] Entering DOB using segmented date control");
      for (const part of ["day", "month", "year"] as const) {
        stage = `${part} entry`;
        operation = "inspect";
        if (part === "year") await logActiveSegment(group, "before_year_entry");
        const field = fields[part]!;
        const structure = await segmentStructure(field, part);
        console.log("[MediRef] DOB segment structure", structure);
        if (structure.disabled || structure.readOnly) throw new Error(failure);
        const customYear = part === "year" && structure.isContentEditable && structure.role === "spinbutton";
        if (customYear) {
          usedCustomYear = true;
          await insertCustomPart(group, part, values.year, value => { operation = value; }, values);
          operation = "year_verify";
          console.log("[MediRef] DOB year_verify", { matches: await segmentMatches(segment(group, "year"), values.year) });
          operation = "year_post_blur_verify";
          try {
            await commitAndVerifyYear(group, values);
          } finally {
            console.log("[MediRef] DOB year_post_blur_verify", { matches: await customYearMatches(segment(group, "year"), values.year) });
          }
          console.log("[MediRef] DOB segment verified", { part });
          continue;
        }
        operation = "write";
        if (structure.native) {
          await field.fill(values[part], { timeout });
          if (part !== "year") await logActiveSegment(group, `after_${part}_entry`);
        } else {
          if (!structure.isContentEditable && structure.role !== "spinbutton") throw new Error(failure);
          if (part !== "year" && structure.isContentEditable && structure.role === "spinbutton") {
            await insertCustomPart(group, part, values[part], value => { operation = value; });
          } else {
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
          }
          if (part !== "year") await logActiveSegment(group, `after_${part}_entry`);
          if (structure.isContentEditable) {
            operation = "commit";
            if (part === "month" && keyboardYear && structure.role !== "spinbutton") {
              operation = "month_pre_navigation_focus";
              await logActiveSegment(group, operation, true);
              if (await segment(group, "year").evaluate(element => document.activeElement === element)) {
                console.log("[MediRef] DOB year_existing_focus_reused");
              } else {
                if (!await segment(group, "month").evaluate(element => document.activeElement === element)) throw new Error(failure);
                operation = "year_navigation_tab_started";
                console.log(`[MediRef] DOB ${operation}`);
                await page.keyboard.press("Tab");
                operation = "year_navigation_tab_completed";
                console.log(`[MediRef] DOB ${operation}`);
                operation = "year_navigation_after_tab";
                await logActiveSegment(group, operation, true);
              }
              // Tab commits month without losing our position in the composite.
              // Resolve both locators again in case the component rendered new nodes.
              if (!await segment(group, "year").evaluate(element => document.activeElement === element)) throw new Error(failure);
              operation = "month_commit_verification";
              await waitForSegment(segment(group, "month"), values.month);
              if (!await segment(group, "year").evaluate(element => document.activeElement === element)) throw new Error(failure);
              console.log("[MediRef] DOB year_navigation_verified");
            } else {
              await field.blur({ timeout });
            }
          }
        }
        operation = "verify";
        await waitForSegment(field, values[part]);
        if (part !== "year") await logActiveSegment(group, `after_${part}_verify`);
        console.log("[MediRef] DOB segment verified", { part });
      }
      stage = "final verification";
      operation = "leave control";
      if (!usedCustomYear) await fields.year.press("Tab", { timeout });
      else if (await fields.year.evaluate(element => document.activeElement === element)) await page.keyboard.press("Tab");
      // Year need not be last in tab order. Commit on group exit before reading values.
      await group.evaluate((element) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && element.contains(active)) active.blur();
      });
      operation = "verify persistence";
      await waitForPersistedDate(group, values, usedCustomYear ? year => customYearMatches(year, values.year) : undefined);
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
