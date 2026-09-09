import type { Page } from "playwright";

const groupSelector = '[data-testid="patient-dob-input"], [data-date-field-input], #dob[role="group"]';

export function parseDobDiagnosticInput(value: unknown) {
  const input = value as { patient?: { firstName?: unknown; lastName?: unknown; dob?: unknown } } | null;
  const patient = input?.patient;
  if (!patient || typeof patient.firstName !== "string" || !patient.firstName.trim() ||
      typeof patient.lastName !== "string" || !patient.lastName.trim() || typeof patient.dob !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(patient.dob)) throw new Error("Invalid MediRef DOB diagnostic input.");
  const date = new Date(`${patient.dob}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== patient.dob) throw new Error("Invalid MediRef DOB diagnostic input.");
  return { patient: { firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob } };
}

// Raw DOM values remain in this browser-side closure. Only allowlisted records leave it.
export async function startDobObservation(page: Page, expectedIso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedIso)) throw new Error("Invalid MediRef DOB diagnostic date.");
  await page.locator(groupSelector).first().waitFor({ state: "visible", timeout: 3000 });
  const inspect = ({ selector, expected }: { selector: string; expected: string }) => {

    const initialGroups = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length);
    if (initialGroups.length !== 1) throw new Error("Ambiguous MediRef DOB diagnostic group.");
    const initialGroup = initialGroups[0];
    const root = initialGroup.parentElement ?? initialGroup;
    const form = initialGroup.closest("form");
    const [year, month, day] = expected.split("-");
    const human = `${day}/${month}/${year}`;
    const normalize = (value: string) => value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
    const matches = (value: string) => [expected, human].includes(normalize(value));
    const groups = () => [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length);
    const group = () => groups().length === 1 ? groups()[0] : null;
    const part = (element: Element) => {
      for (const attribute of ["data-segment", "data-type", "aria-label"]) {
        const value = element.getAttribute(attribute) ?? "";
        const match = value.match(/^(day|month|year)(?:\b|$)/i);
        if (match) return match[1].toLowerCase();
      }
      return "other";
    };
    const target = (element: Element) => ({
      tagName: ["INPUT", "SPAN", "DIV", "TEXTAREA", "SELECT", "BUTTON", "FORM"].includes(element.tagName) ? element.tagName : "OTHER",
      role: ["spinbutton", "group", "textbox", "alert"].includes(element.getAttribute("role") ?? "") ? element.getAttribute("role") : element.hasAttribute("role") ? "other" : null,
      dataSegment: ["day", "month", "year"].includes(element.getAttribute("data-segment") ?? "") ? element.getAttribute("data-segment") : element.hasAttribute("data-segment") ? "other" : null,
    });
    const candidates = () => {
      const nearby = [...root.querySelectorAll('input[type="hidden"], input[hidden]')];
      const named = [...document.querySelectorAll('input[name*="dob" i], input[name*="birth" i]')].filter(e => root.contains(e) || (form && e instanceof HTMLInputElement && e.form === form));
      return [...new Set([...nearby, ...named])].filter((e): e is HTMLInputElement => e instanceof HTMLInputElement);
    };
    const serializedAttributes = ["data-value", "data-date", "data-selected-value", "value"];
    const ids = new WeakMap<Element, number>();
    let nextId = 0;
    const id = (e: Element) => { if (!ids.has(e)) ids.set(e, ++nextId); return ids.get(e)!; };
    const candidateRaw = () => candidates().map(e => [id(e), e.value, e.checked, e.disabled]);
    const ariaRaw = () => [...(group()?.querySelectorAll('[role="spinbutton"]') ?? [])].map(e => [part(e), e.getAttribute("aria-valuenow")]);
    const groupRaw = () => {
      const e = group();
      return e ? [e.getAttribute("aria-invalid"), e.hasAttribute("data-invalid"), ...serializedAttributes.map(a => e.getAttribute(a))] : null;
    };
    const beforeCandidates = JSON.stringify(candidateRaw());
    const beforeAria = JSON.stringify(ariaRaw());
    const beforeGroup = JSON.stringify(groupRaw());
    let explicitSignal = false;
    let focusoutObserved = false;
    let droppedRecords = 0;
    const events: Array<Record<string, unknown>> = [];
    const mutations: Array<Record<string, unknown>> = [];
    const append = (list: Array<Record<string, unknown>>, value: Record<string, unknown>) => {
      if (list.length < 200) list.push(value); else droppedRecords++;
    };
    const relevant = (e: Element) => Boolean(group()?.contains(e) || candidates().includes(e as HTMLInputElement));
    const eventTypes = ["beforeinput", "input", "change", "blur", "focusout", "keydown", "keyup"];
    const observedEvents = new Set<string>();
    const listen = (event: Event) => {
      if (!(event.target instanceof Element) || !relevant(event.target)) return;
      observedEvents.add(event.type);
      if (event.type === "focusout") focusoutObserved = true;
      append(events, { eventType: event.type, ...target(event.target), insideDobGroup: Boolean(group()?.contains(event.target)) });
    };
    for (const type of eventTypes) document.addEventListener(type, listen, true);
    const done = () => { explicitSignal = true; };
    window.addEventListener("mediref-dob-diagnostic-done", done);
    const safeAttributes = ["value", "checked", "type", "name", "role", "contenteditable", "tabindex", "aria-invalid", "aria-valuenow", "aria-valuetext", "aria-disabled", "aria-readonly", "data-invalid", "data-segment", "data-type", ...serializedAttributes];
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!element) continue;
        const structureChange = record.type === "childList" && (element === root || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(selector) || node.matches('input[type="hidden"], input[hidden]'))));
        if (!relevant(element) && !structureChange) continue;
        append(mutations, { mutationType: record.type, attributeName: record.attributeName === null ? null : safeAttributes.includes(record.attributeName) ? record.attributeName : "other", ...target(element), candidateStateChanged: JSON.stringify(candidateRaw()) !== beforeCandidates });
      }
    });
    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    for (const e of candidates()) if (!root.contains(e)) observer.observe(e, { attributes: true, childList: true, subtree: true });
    const snapshot = () => {
      const g = group();
      const segments = [...(g?.querySelectorAll('[role="spinbutton"], [data-segment], [data-type]') ?? [])];
      const inputs = candidates();
      const linkedMessage = (g?.getAttribute("aria-errormessage") ?? "").split(/\s+/).some(key => Boolean(key && document.getElementById(key)?.getClientRects().length));
      return {
        dobGroupCount: groups().length,
        activeElementInsideDobGroup: Boolean(g?.contains(document.activeElement)),
        visiblePartsMatchExpected: [["day", day], ["month", month], ["year", year]].every(([name, value]) => {
          const found = segments.filter(e => part(e) === name);
          return found.length === 1 && /^\d+$/.test(normalize(found[0].textContent ?? "")) && Number(normalize(found[0].textContent ?? "")) === Number(value);
        }),
        segments: segments.slice(0, 12).map(e => ({ part: part(e), ...target(e), dataSegmentPresent: e.hasAttribute("data-segment"), contentEditable: e instanceof HTMLElement && e.isContentEditable, tabIndexPresent: e.hasAttribute("tabindex"), ariaInvalidPresent: e.hasAttribute("aria-invalid"), ariaValueNowPresent: e.hasAttribute("aria-valuenow"), ariaValueTextPresent: e.hasAttribute("aria-valuetext") })),
        segmentCounts: { day: segments.filter(e => part(e) === "day").length, month: segments.filter(e => part(e) === "month").length, year: segments.filter(e => part(e) === "year").length },
        hasHiddenDobInput: inputs.some(e => (e.type === "hidden" || e.hidden) && (g?.contains(e) || /dob|birth/i.test(e.name))),
        hasNearbyHiddenInput: inputs.some(e => e.type === "hidden" || e.hidden),
        candidateInputCount: inputs.length,
        candidates: inputs.slice(0, 40).map(e => ({ candidateId: id(e), exists: true, insideDobGroup: Boolean(g?.contains(e)), nameHasDobHint: /dob|birth/i.test(e.name), inputType: ["hidden", "text", "date", "number", "tel"].includes(e.type) ? e.type : "other", namePresent: e.hasAttribute("name"), safeNameKey: ["dob", "birth", "birthdate", "dateofbirth", "date_of_birth", "date-of-birth", "patientdob", "patient_dob"].includes(e.name.toLowerCase()) ? e.name.toLowerCase() : "other", valueEmpty: e.value.length === 0, matchesExpectedDob: matches(e.value), formAssociated: Boolean(e.form), checked: e.checked, disabled: e.disabled })),
        dobGroupAriaInvalid: g?.getAttribute("aria-invalid") === "true",
        dataInvalidPresent: g?.hasAttribute("data-invalid") ?? false,
        validationMessagePresent: linkedMessage || Boolean(root.querySelector('[role="alert"], [data-error-message]')),
        hasSerializedDobField: Boolean(g && serializedAttributes.some(a => g.hasAttribute(a))),
        serializedFields: g ? serializedAttributes.filter(a => g.hasAttribute(a)).map(a => ({ attributeName: a, valueEmpty: !g.getAttribute(a), matchesExpectedDob: matches(g.getAttribute(a) ?? "") })) : [],
        associatedFieldStateChanged: JSON.stringify(candidateRaw()) !== beforeCandidates,
        groupStateChangedAfterCommit: JSON.stringify(groupRaw()) !== beforeGroup,
        ariaNowChanged: JSON.stringify(ariaRaw()) !== beforeAria,
        yearAriaNowChangedAfterCommit: JSON.stringify(ariaRaw().filter(row => row[0] === "year")) !== JSON.stringify((JSON.parse(beforeAria) as Array<unknown[]>).filter(row => row[0] === "year")),
        observedEventTypes: [...observedEvents], focusoutObserved, explicitSignal, droppedRecords,
      };
    };
    return {
      snapshot,
      drain: () => ({ events: events.splice(0), mutations: mutations.splice(0) }),
      stop: () => { observer.disconnect(); for (const type of eventTypes) document.removeEventListener(type, listen, true); window.removeEventListener("mediref-dob-diagnostic-done", done); },
    };
  };
  // tsx adds __name calls to nested functions. Supply that helper in the serialized
  // closure, never on the live window. Arguments are JSON encoded, not executable input.
  return page.evaluateHandle<ReturnType<typeof inspect>>(`(() => {
    const __name = fn => fn;
    return (${inspect.toString()})(${JSON.stringify({ selector: groupSelector, expected: expectedIso })});
  })()`);
}
