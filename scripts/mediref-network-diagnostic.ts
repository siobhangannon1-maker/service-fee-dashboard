import type { BrowserContext, Request } from "playwright";

const limit = 256 * 1024;
const knownKeys = new Set("payload refreshes result success ok error errors status data type s3uuid patient name firstName lastName dob dateOfBirth date_of_birth birthDate birth_date patientDob patient_dob patientName patient_name ptEmail recipients recipient recipientId practiceName doctors files file attachments attachment key filename originalName customName ext size progress uploadAttempts uploadId s3key recipientMsg correspondenceId url uploadUrl signedUrl fields uploadStarted bytesUploaded bytesTotal percentage".split(" "));
const routes = { save: "/_app/remote/fd8vn1/saveDraft", upload: "/_app/remote/1wqh9sd/getUploadParameters", send: "/_app/remote/r6r93r/sendCorrespondence", delete: "/_app/remote/143lgbm/deleteDraft" };

export function sanitizeNetworkPath(raw: string, origin = "https://www.mediref.com.au") {
  let url: URL;
  try { url = new URL(raw); } catch { return { sameOrigin: false, pathname: "unrecognized", routeId: null, action: "unknown" }; }
  if (url.origin !== origin) return { sameOrigin: false, pathname: "external_request", routeId: null, action: "unknown" };
  const remote = url.pathname.match(/^\/_app\/remote\/([a-z0-9]{1,12})\/([a-zA-Z]+)$/);
  const action = remote && ["saveDraft", "getUploadParameters", "sendCorrespondence", "deleteDraft"].includes(remote[2]) ? remote[2] : "unknown";
  return {
    sameOrigin: true,
    pathname: remote ? `/_app/remote/{route-id}/${action === "unknown" ? "{action}" : action}` :
      /^\/compose\/[^/]+\/__data\.json$/.test(url.pathname) ? "/compose/{id}/__data.json" :
      url.pathname === "/compose" ? "/compose" : url.pathname === "/search/__data.json" ? "/search/__data.json" : "/{unclassified}",
    routeId: remote?.[1] ?? null, action,
  };
}

function parseJson(raw: string | null) {
  if (!raw || Buffer.byteLength(raw) > limit) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}
function decodedPayload(value: unknown) {
  if (typeof value !== "string" || value.length > limit || !/^[A-Za-z0-9+/_=-]+$/.test(value)) return null;
  return parseJson(Buffer.from(value, "base64").toString("utf8"));
}
function keys(value: unknown) {
  const names = new Set<string>();
  let visited = 0;
  const walk = (item: unknown, depth: number) => {
    if (++visited > 3000 || depth > 12 || !item || typeof item !== "object") return;
    if (Array.isArray(item)) { for (const child of item.slice(0, 1000)) walk(child, depth + 1); return; }
    for (const [key, child] of Object.entries(item).slice(0, 200)) {
      if (knownKeys.has(key)) names.add(key);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return [...names].sort();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function flags(names: string[]) {
  return {
    containsDobField: names.some(key => /^(dob|dateOfBirth|date_of_birth|birthDate|birth_date|patientDob|patient_dob)$/.test(key)),
    containsPatientField: names.some(key => ["patient", "patientName", "patient_name", "firstName", "lastName", "name"].includes(key)),
    containsFilesField: names.some(key => ["files", "file", "attachments", "attachment", "filename", "originalName", "s3key", "uploadId"].includes(key)),
    containsRecipientsField: names.some(key => ["recipients", "recipient", "recipientId"].includes(key)),
  };
}
export function sanitizeRequestShape(contentType: string, raw: string | null) {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const json = mime === "application/json" ? parseJson(raw) : null;
  const decoded = decodedPayload(record(json).payload);
  const topLevelKeys = Object.keys(record(json)).filter(key => knownKeys.has(key)).sort();
  const decodedFieldNames = keys(decoded);
  const fieldNames = keys(json);
  if (mime === "application/x-www-form-urlencoded" && raw && raw.length <= limit) {
    for (const key of new URLSearchParams(raw).keys()) if (knownKeys.has(key) && !fieldNames.includes(key)) fieldNames.push(key);
  }
  return {
    contentType: ["application/json", "application/pdf", "application/octet-stream", "multipart/form-data", "application/x-www-form-urlencoded"].includes(mime) ? mime : "other",
    bodyType: mime === "application/json" ? "json" : ["multipart/form-data", "application/x-www-form-urlencoded"].includes(mime) ? "form" : raw === null && !mime ? "none" : "raw-binary",
    topLevelKeys, fieldNames, decodedFieldNames,
    decodedTopLevelKeys: Object.keys(record(Array.isArray(decoded) ? decoded[0] : decoded)).filter(key => knownKeys.has(key)).sort(),
    fieldInspectionAvailable: json !== null || (mime === "application/x-www-form-urlencoded" && raw !== null && raw.length <= limit),
    payloadDecoded: decoded !== null,
    ...flags([...fieldNames, ...decodedFieldNames]),
  };
}
export function sanitizeResponseShape(raw: string | null) {
  const outer = parseJson(raw);
  const inner = parseJson(typeof record(outer).result === "string" ? record(outer).result as string : null);
  const candidates = [record(outer), record(inner), ...((Array.isArray(inner) ? inner : Array.isArray(outer) ? outer : []).slice(0, 100).map(record))];
  return {
    responseKeys: [...new Set([...keys(outer), ...keys(inner)])].sort(),
    successFlagPresent: candidates.some(v => "success" in v || "ok" in v),
    successFlagTrue: candidates.some(v => v.success === true || v.success === 1 || v.ok === true || v.ok === 1),
    errorFlagPresent: candidates.some(v => "error" in v || "errors" in v),
  };
}

// Passive listener: never alters or replays requests, and never reads binary upload bodies.
export function startNetworkDiagnostic(context: BrowserContext, origin: string) {
  const entries: Array<Record<string, unknown>> = [];
  const pending = new Set<Promise<void>>();
  const byRequest = new Map<Request, Record<string, unknown>>();
  const signedUrls = new Set<string>(); // Private correlation only; never returned or printed.
  const urls = new Map<Record<string, unknown>, string>();
  let dropped = 0;
  let sequence = 0;
  const track = (work: Promise<void>) => { pending.add(work); void work.finally(() => pending.delete(work)); };
  const requestListener = (request: Request) => {
    const route = sanitizeNetworkPath(request.url(), origin);
    if (!route.sameOrigin && request.method() !== "PUT") return;
    if (route.sameOrigin && !["xhr", "fetch", "document"].includes(request.resourceType())) return;
    if (entries.length >= 300) { dropped++; return; }
    const pathname = new URL(request.url()).pathname;
    const entry: Record<string, unknown> = {
      sequence: ++sequence, method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(request.method()) ? request.method() : "other",
      ...route, matchesHistoricalSaveDraftRoute: route.sameOrigin && pathname === routes.save,
      matchesHistoricalUploadParamsRoute: route.sameOrigin && pathname === routes.upload,
      matchesHistoricalSendRoute: route.sameOrigin && pathname === routes.send,
      matchesHistoricalDeleteRoute: route.sameOrigin && pathname === routes.delete,
      responseStatus: null,
    };
    entries.push(entry); byRequest.set(request, entry); urls.set(entry, request.url());
    track((async () => {
      try {
        const type = await request.headerValue("content-type") ?? "";
        // Raw external/file bodies are deliberately not fetched from Playwright.
        const readable = route.sameOrigin && /^(application\/json|application\/x-www-form-urlencoded)(;|$)/i.test(type);
        Object.assign(entry, sanitizeRequestShape(type, readable ? request.postData() : null));
      } catch { entry.inspectionUnavailable = true; }
    })());
  };
  const responseListener = (response: import("playwright").Response) => {
    const entry = byRequest.get(response.request());
    if (!entry) return;
    entry.responseSequence = ++sequence;
    entry.responseStatus = response.status();
    track((async () => {
      try {
        if (!entry.sameOrigin || !(await response.headerValue("content-type"))?.toLowerCase().includes("application/json")) return;
        // Require a bounded declared length before reading a response body.
        const length = Number(await response.headerValue("content-length"));
        if (!Number.isFinite(length) || length <= 0 || length > limit) { entry.responseShapeUnavailable = true; return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const raw = await Promise.race([
          response.text(),
          new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error("Response inspection timed out.")), 5000); }),
        ]).finally(() => clearTimeout(timer));
        Object.assign(entry, sanitizeResponseShape(raw));
        if (entry.action === "getUploadParameters") {
          const parsed = parseJson(raw);
          const inner = parseJson(typeof record(parsed).result === "string" ? record(parsed).result as string : null);
          let visited = 0;
          const find = (value: unknown, depth: number) => {
            if (++visited > 3000 || depth > 12) return;
            if (typeof value === "string" && value.startsWith("https://") && value.length < 8192) signedUrls.add(value);
            else if (Array.isArray(value)) value.slice(0, 1000).forEach(v => find(v, depth + 1));
            else if (value && typeof value === "object") Object.values(value).slice(0, 200).forEach(v => find(v, depth + 1));
          };
          find(inner ?? parsed, 0);
        }
      } catch { entry.responseShapeUnavailable = true; }
    })());
  };
  context.on("request", requestListener);
  context.on("response", responseListener);
  return {
    async stop() {
      context.off("request", requestListener); context.off("response", responseListener);
      await Promise.all([...pending]);
      let uploadSeen = false;
      for (const entry of entries) {
        const externalUpload = !entry.sameOrigin && entry.method === "PUT";
        const signed = externalUpload && signedUrls.has(urls.get(entry) ?? "");
        entry.classification = entry.action === "saveDraft" ? (uploadSeen ? "draft_save_after_upload_request" : "draft_save_before_upload_request") :
          entry.action === "getUploadParameters" ? "upload_parameters" : entry.pathname === "/compose/{id}/__data.json" ? "compose_data_load" :
            externalUpload ? signed ? "signed_storage_upload" : "external_upload_candidate" : "unclassified";
        if (externalUpload) { entry.pathname = signed ? "external_signed_upload" : "external_upload_candidate"; uploadSeen = true; }
      }
      urls.clear(); signedUrls.clear(); byRequest.clear();
      return { requests: entries, droppedRecords: dropped, note: "Sequence and success flags are evidence only; saved DOB and attachment acceptance require review." };
    },
  };
}

// Local-only structural capture. Unknown values and dynamic keys are never emitted.
const schemaKeys = new Set([...knownKeys, ..."nodes uses dependencies params parent route slash server universal form draft drafts practice practiceId practice_id id version uploadPrefix storageKey storagePrefix extraPwType customPw pwHint ptMsg clientGreetingPeriod externalRecipientReview email phone address doctor token csrf authorization cookie accessToken".split(" ")]);
function category(key: string): string {
  if (/s3uuid|draft.?id/i.test(key)) return "DRAFT_ID";
  if (/practice.?id/i.test(key)) return "PRACTICE_ID";
  if (/upload.?id/i.test(key)) return "UPLOAD_ID";
  if (/correspondence.?id/i.test(key)) return "CORRESPONDENCE_ID";
  if (/dob|birth/i.test(key)) return "DOB";
  if (/email/i.test(key)) return "EMAIL";
  if (/phone/i.test(key)) return "PHONE";
  if (/address/i.test(key)) return "ADDRESS";
  if (/practiceName/i.test(key)) return "PRACTICE_NAME";
  if (/doctor.*name/i.test(key)) return "DOCTOR_NAME";
  if (/name/i.test(key)) return "PATIENT_NAME";
  if (/key|prefix/i.test(key)) return "STORAGE_KEY";
  return "TOKEN";
}
export function sanitizeInitializationStructures(compose: unknown, save: unknown) {
  const identities = new Map<string, string>();
  const counts = new Map<string, number>();
  const placeholder = (value: string | number, hint: string): unknown => {
    if (value === "") return "";
    let kind = category(hint);
    if (typeof value === "string" && /^https?:\/\//i.test(value)) kind = /[?&](?:x-amz-|signature|sig=|token=)/i.test(value) ? "SIGNED_URL" : "URL";
    const identity = `${typeof value}:${value}`;
    let label = identities.get(identity);
    if (!label) { const n = (counts.get(kind) ?? 0) + 1; counts.set(kind, n); label = n === 1 ? kind : `${kind}_${n}`; identities.set(identity, label); }
    return typeof value === "number" ? { __placeholder: label, type: "number" } : `<${label}>`;
  };
  let visited = 0;
  const sanitize = (value: unknown, hint = "", table = false, depth = 0): unknown => {
    if (++visited > 20000 || depth > 40) throw new Error("Structural capture exceeds safe limits.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string" || typeof value === "number") return placeholder(value, hint);
    if (Array.isArray(value)) {
      if (table) {
        // References live inside table objects/arrays; numeric table entries are values.
        const hints = new Map<number, string>();
        for (const item of value) if (item && !Array.isArray(item) && typeof item === "object") {
          for (const [key, ref] of Object.entries(item)) if (typeof ref === "number" && ref >= 0 && ref < value.length) {
            if (!hints.has(ref) || category(key) !== "TOKEN") hints.set(ref, key);
          }
        }
        const references = (item: unknown, level: number): unknown => {
          if (++visited > 20000 || level > 40) throw new Error("Structural capture exceeds safe limits.");
          if (typeof item === "number") return item;
          if (Array.isArray(item)) return item.map(v => references(v, level + 1));
          if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [safeKey(key), references(child, level + 1)]));
          return sanitize(item, "", false, level);
        };
        return value.map((item, index) => item && typeof item === "object" ? references(item, depth + 1) : sanitize(item, hints.get(index), false, depth + 1));
      }
      return value.map(item => sanitize(item, hint, false, depth + 1));
    }
    return Object.fromEntries(Object.entries(record(value)).map(([key, child]) => [safeKey(key), sanitize(child, key, key === "data" && Array.isArray(child), depth + 1)]));
  };
  const safeKey = (key: string) => schemaKeys.has(key) ? key : String(placeholder(key, ""));
  return { compose: sanitize(compose), saveDraft: sanitize(save, "", Array.isArray(save)) };
}

function initializationEvidence(value: unknown, flattened = false) {
  const draftIds = new Set<unknown>(); const practices = new Set<unknown>();
  let uploadPrefix = false; let draft = false; let visits = 0;
  const walk = (item: unknown, table?: unknown[], depth = 0) => {
    if (++visits > 20000 || depth > 40) return;
    if (Array.isArray(item)) { item.forEach(v => walk(v, table, depth + 1)); return; }
    const obj = record(item);
    if ("patient" in obj && "files" in obj && "s3uuid" in obj) draft = true;
    for (const [key, child] of Object.entries(obj)) {
      const resolved = table && typeof child === "number" ? table[child] : child;
      if (/^(s3uuid|draftId|draft_id)$/.test(key) && ["string", "number"].includes(typeof resolved) && resolved !== "") draftIds.add(resolved);
      if (/^practice_?id$/i.test(key) && ["string", "number"].includes(typeof resolved) && resolved !== "") practices.add(resolved);
      if (/^(uploadPrefix|storagePrefix|storageKey|s3key)$/.test(key) && typeof resolved === "string" && resolved !== "") uploadPrefix = true;
      if (key === "data" && Array.isArray(child)) walk(child, child, depth + 1);
      else if (child && typeof child === "object") walk(child, table, depth + 1);
    }
  };
  walk(value, flattened && Array.isArray(value) ? value : undefined);
  return { draftIds, practices, uploadPrefix, draft };
}
export function compareInitializationStructures(compose: unknown, save: unknown) {
  const c = initializationEvidence(compose); const s = initializationEvidence(save, true);
  return {
    composeContainsDraftObject: c.draft, composeContainsS3uuid: c.draftIds.size > 0,
    composeContainsPracticeId: c.practices.size > 0, composeContainsUploadPrefix: c.uploadPrefix,
    saveDraftContainsS3uuid: s.draftIds.size > 0, saveDraftContainsPracticeId: s.practices.size > 0,
    saveDraftContainsUploadPrefix: s.uploadPrefix,
    sameDraftIdentifierObserved: [...c.draftIds].some(id => s.draftIds.has(id)),
    practiceIdentifierSource: c.practices.size && s.practices.size ? "ambiguous" : c.practices.size ? "compose" : s.practices.size ? "saveDraft" : "neither",
    baselineDraftSource: c.draft ? "compose" : "ambiguous",
  };
}

export function startInitializationDiagnostic(context: BrowserContext, page: import("playwright").Page) {
  let compose: unknown = null; let save: unknown = null; let firstSaveSeen = false;
  const pending = new Set<Promise<void>>();
  let resolveFirst!: () => void;
  const firstSave = new Promise<void>(resolve => { resolveFirst = resolve; });
  const belongs = (request: Request) => {
    try { return request.frame().page() === page && new URL(request.url()).origin === new URL(page.url()).origin; } catch { return false; }
  };
  const onRequest = (request: Request) => {
    if (!belongs(request) || request.method() !== "POST" || new URL(request.url()).pathname !== routes.save || firstSaveSeen) return;
    firstSaveSeen = true;
    save = decodedPayload(record(parseJson(request.postData())).payload);
    resolveFirst();
  };
  const onResponse = (response: import("playwright").Response) => {
    if (!belongs(response.request()) || response.request().method() !== "GET" || !/^\/compose\/[^/]+\/__data\.json$/.test(new URL(response.url()).pathname) || compose !== null) return;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!response.ok() || !(await response.headerValue("content-type"))?.includes("application/json")) return;
        const length = Number(await response.headerValue("content-length"));
        if (!Number.isFinite(length) || length <= 0 || length > limit) return;
        const raw = await Promise.race([response.text(), new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error("Capture unavailable.")), 5000); })]);
        if (compose === null) compose = parseJson(raw);
      } catch { /* Missing evidence is reported as null, never raw errors. */ }
      finally { clearTimeout(timer); }
    })();
    pending.add(work); void work.finally(() => pending.delete(work));
  };
  context.on("request", onRequest); context.on("response", onResponse);
  return {
    async waitForFirstSave(timeoutMs = 120_000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([firstSave, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("First save capture timed out.")), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    },
    async stop() {
      context.off("request", onRequest); context.off("response", onResponse);
      await Promise.all([...pending]);
      try { return { ...sanitizeInitializationStructures(compose, save), comparison: compareInitializationStructures(compose, save) }; }
      finally { compose = null; save = null; }
    },
  };
}

function wireRoot(value: unknown) { return record(Array.isArray(value) ? value[0] : value); }
function wireValue(value: unknown, ref: unknown) { return Array.isArray(value) && typeof ref === "number" ? value[ref] : ref; }
function segmentKind(value: string) {
  return /^\d+$/.test(value) ? "numeric" : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? "uuid" : /^[a-zA-Z0-9_-]+$/.test(value) ? "opaque" : "other";
}
export function analyzeUploadKey(key: unknown, draftId: unknown, savedKey: unknown, knownPracticeIds: unknown[] = []) {
  const present = typeof key === "string" && key.length > 0;
  const parts = present ? key.split("/") : [];
  const draftIndex = typeof draftId === "string" && draftId !== "" ? parts.indexOf(draftId) : -1;
  const prefix = draftIndex > 0 ? parts[0] : null;
  return {
    keyPresent: present, keySegmentCount: parts.length, keyUsesSlashSeparators: parts.length > 1,
    keyContainsCurrentDraftId: draftIndex >= 0, draftIdSegmentIndex: draftIndex >= 0 ? draftIndex : null,
    prefixSegmentCount: draftIndex >= 0 ? draftIndex : null,
    suffixSegmentCount: draftIndex >= 0 ? parts.length - draftIndex - 1 : null,
    segments: parts.map((part, index) => ({ index, classification: part === draftId ? "matchesDraftId" : knownPracticeIds.some(id => String(id) === part) ? "matchesKnownPracticeIdentifier" : segmentKind(part) })),
    practicePrefixClassification: prefix === null ? "absent" : segmentKind(prefix) === "other" ? "opaque" : segmentKind(prefix),
    saveDraftFileKeyPresent: typeof savedKey === "string" && savedKey.length > 0,
    saveDraftFileKeyMatchesUploadRequestKey: present && savedKey === key,
    uploadIdShape: draftIndex >= 0 && parts.length === draftIndex + 2 ? segmentKind(parts.at(-1)!) : "unknown",
    uploadIdSource: "unknown",
  };
}
export function savedFileStructure(save: unknown) {
  const files = wireValue(save, wireRoot(save).files);
  const ref = Array.isArray(files) ? files[0] : undefined;
  const file = record(wireValue(save, ref));
  if (!Object.keys(file).length) return null;
  const sanitized = sanitizeInitializationStructures(null, save).saveDraft;
  if (!Array.isArray(save) || !Array.isArray(sanitized) || typeof ref !== "number") return sanitizeInitializationStructures(file, null).compose;
  // Retain original indices for only this file's reachable table entries.
  const indices = new Set<number>();
  const visit = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= save.length || indices.has(index)) return;
    indices.add(index);
    const item = save[index];
    if (item && typeof item === "object") for (const child of Object.values(item)) if (typeof child === "number") visit(child);
  };
  visit(ref);
  return { fileReference: ref, tableLength: save.length, indexedEntries: Object.fromEntries([...indices].sort((a, b) => a - b).map(index => [index, sanitized[index]])) };
}

export function startUploadKeyDiagnostic(context: BrowserContext, page: import("playwright").Page) {
  let reusablePrefix: string | null = null; let originalDraft: string | null = null;
  const bootstrap = readLocalUploadBootstrap(page).catch(() => []);
  let draftId: unknown; let key: unknown; let save: unknown = null;
  let uploadSeen = false; let putStatus: number | null = null; let requestCount = 0;
  let responseCount = 0; let completed = false;
  const practices = new Set<unknown>(); const priorStrings = new Set<string>();
  const signedUrls = new Set<string>(); const pending = new Set<Promise<void>>();
  let eventOrder = 0;
  const puts: Array<{ url: string; status: number; order: number }> = [];
  const saves: Array<{ value: unknown; order: number }> = [];
  const finishIfCorrelated = () => {
    if (completed) return;
    const put = puts.find(item => signedUrls.has(item.url));
    const candidate = put && saves.find(item => item.order > put.order);
    if (put && candidate) { putStatus = put.status; save = candidate.value; completed = true; resolveDone(); }
  };
  let resolveDone!: () => void; const done = new Promise<void>(resolve => { resolveDone = resolve; });
  const belongs = (request: Request, sameOrigin = true) => {
    try { return request.frame().page() === page && (!sameOrigin || new URL(request.url()).origin === new URL(page.url()).origin); } catch { return false; }
  };
  const collectStrings = (value: unknown, output: Set<string>, depth = 0) => {
    if (depth > 30 || output.size > 10000) return;
    if (typeof value === "string") output.add(value);
    else if (value && typeof value === "object") Object.values(value).forEach(child => collectStrings(child, output, depth + 1));
  };
  const onRequest = (request: Request) => {
    if (completed || !belongs(request) || request.method() !== "POST" || ++requestCount > 300) return;
    const pathname = new URL(request.url()).pathname;
    if (pathname !== routes.save && pathname !== routes.upload) return;
    const decoded = decodedPayload(record(parseJson(request.postData())).payload);
    if (pathname === routes.save) {
      const id = wireValue(decoded, wireRoot(decoded).s3uuid);
      if (!uploadSeen) draftId = id;
      if (uploadSeen && id === draftId && saves.length < 30) { saves.push({ value: decoded, order: ++eventOrder }); finishIfCorrelated(); }
    } else if (!uploadSeen) {
      uploadSeen = true; key = wireValue(decoded, wireRoot(decoded).key);

    }
  };
  const onResponse = (response: import("playwright").Response) => {
    const request = response.request();
    if (completed || !belongs(request, false)) return;
    if (request.method() === "PUT") { if (puts.length < 30) puts.push({ url: response.url(), status: response.status(), order: ++eventOrder }); finishIfCorrelated(); return; }
    if (!belongs(request) || ++responseCount > 30) return;
    const isParams = new URL(response.url()).pathname === routes.upload;
    const wasPrior = !uploadSeen;
    if (!wasPrior && !isParams) return;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!(await response.headerValue("content-type"))?.includes("application/json")) return;
        const length = Number(await response.headerValue("content-length"));
        if (!Number.isFinite(length) || length <= 0 || length > limit) return;
        const raw = await Promise.race([response.text(), new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error("Capture unavailable.")), 5000); })]);
        const outer = parseJson(raw);
        const inner = parseJson(typeof record(outer).result === "string" ? record(outer).result as string : null);
        if (wasPrior) {
          for (const value of [outer, inner]) {
            for (const id of initializationEvidence(value, Array.isArray(value)).practices) practices.add(id);
            collectStrings(value, priorStrings);
          }
        }
        if (isParams) {
          const strings = new Set<string>(); collectStrings(inner ?? outer, strings);
          for (const value of strings) if (value.startsWith("https://")) signedUrls.add(value);
          finishIfCorrelated();
        }
      } catch { /* No raw response errors enter diagnostic output. */ }
      finally { clearTimeout(timer); }
    })();
    pending.add(work); void work.finally(() => pending.delete(work));
  };
  context.on("request", onRequest); context.on("response", onResponse);
  return {
    async waitForUploadSave(timeoutMs = 180_000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([done, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("Upload capture timed out.")), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    },
    async verifyFreshDraft(timeoutMs = 120_000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let listener: ((request: Request) => void) | undefined;
      try {
        if (!reusablePrefix || !originalDraft) return { prefixReusableAcrossDrafts: null, uploadParametersAccepted: false, productionSourceProven: false };
        const second = await new Promise<string>((resolve, reject) => {
          listener = request => {
            if (!belongs(request) || request.method() !== "POST" || new URL(request.url()).pathname !== routes.save) return;
            const decoded = decodedPayload(record(parseJson(request.postData())).payload);
            const id = wireValue(decoded, wireRoot(decoded).s3uuid);
            if (typeof id === "string" && id !== originalDraft) resolve(id);
          };
          context.on("request", listener);
          timer = setTimeout(() => reject(new Error("Fresh draft observation timed out.")), timeoutMs);
        });
        return await verifyLocalPrefixReuse(page, reusablePrefix, originalDraft, second);
      } finally {
        clearTimeout(timer); if (listener) context.off("request", listener);
        reusablePrefix = null; originalDraft = null;
      }
    },
    discardReuse() { reusablePrefix = null; originalDraft = null; },
    async stop(allowLocalReuse = false) {
      context.off("request", onRequest); context.off("response", onResponse); await Promise.all([...pending]);
      try {
        const files = wireValue(save, wireRoot(save).files);
        const file = record(wireValue(save, Array.isArray(files) ? files[0] : undefined));
        const savedKey = wireValue(save, file.key ?? file.s3key);
        const analysis = analyzeUploadKey(key, draftId, savedKey, [...practices]);
        const parts = typeof key === "string" ? key.split("/") : [];
        const practiceAvailable = analysis.prefixSegmentCount !== null && analysis.prefixSegmentCount > 0 && [...practices].some(id => String(id) === parts[0]);
        const source = assessAutomaticUploadSource(await bootstrap, typeof key === "string" ? key : "", typeof draftId === "string" ? draftId : "");
        if (allowLocalReuse && completed && putStatus !== null && putStatus >= 200 && putStatus < 300 && analysis.saveDraftFileKeyMatchesUploadRequestKey && parts.length === 3 && parts[1] === draftId) { reusablePrefix = parts[0]; originalDraft = String(draftId); }
        return {
          runtimeSource: { ...source, clientUploadHelperAvailable: false, clientUploadHelperCanProduceKey: false, clientHelperInspectionCompleted: false },
          analysis: { ...analysis, practicePrefixAvailable: practiceAvailable, practicePrefixSource: practiceAvailable ? "prior_response" : "unknown",
            uploadSuffixObservedInPriorResponse: parts.length > 1 && priorStrings.has(parts.at(-1)!),
            uploadKeyPresentBeforeParameterResponse: uploadSeen && typeof key === "string", signedPutStatus: putStatus, postUploadSaveObserved: completed },
          fileMetadata: savedFileStructure(save),
        };
      } finally { draftId = undefined; key = undefined; save = null; practices.clear(); priorStrings.clear(); signedUrls.clear(); puts.length = 0; saves.length = 0; }
    },
  };
}

export function assessAutomaticUploadSource(values: unknown[], key: string, draftId: string) {
  const parts = key.split("/");
  if (parts.length !== 3 || parts[1] !== draftId || parts.some(part => !part)) return { completeUploadKeyAvailable: false, prefixAvailable: false, sourceType: "unknown", productionSourceProven: false };
  let full = false; let prefix = false; let visited = 0;
  const walk = (value: unknown, depth = 0) => {
    if (++visited > 20000 || depth > 30) return;
    if (typeof value === "string") { full ||= value === key; prefix ||= value === parts[0]; }
    else if (typeof value === "number") prefix ||= String(value) === parts[0];
    else if (value && typeof value === "object") Object.values(value).forEach(child => walk(child, depth + 1));
  };
  values.forEach(value => walk(value));
  return { completeUploadKeyAvailable: full, prefixAvailable: prefix, sourceType: full || prefix ? "bootstrap_data" : "unknown", productionSourceProven: false };
}

// Targeted read only: JSON bootstrap scripts, never globals, cookies, HTML or JS execution.
export async function readLocalUploadBootstrap(page: import("playwright").Page): Promise<unknown[]> {
  const origin = new URL(page.url());
  if (origin.protocol !== "https:" || !["www.mediref.com.au", "mediref.com.au"].includes(origin.hostname)) return [];
  const texts = await page.locator('script[type="application/json"], script[data-sveltekit-fetched]').evaluateAll(elements => {
    let size = 0;
    const output: string[] = [];
    for (const element of elements.slice(0, 30)) {
      const text = element.textContent ?? "";
      size += text.length;
      if (size > 256 * 1024) break;
      output.push(text);
    }
    return output;
  });
  return texts.map(parseJson).filter(value => value !== null);
}

export function automaticSourceEligible(source: string, proven: boolean) {
  return proven && ["page_state", "route_data", "bootstrap_data", "client_state"].includes(source);
}

// Local diagnostic only: one parameter request, no file PUT, save, send or delete.
export async function verifyLocalPrefixReuse(page: import("playwright").Page, prefix: string, firstDraft: string, secondDraft: string) {
  const url = new URL(page.url());
  const safeResult = { prefixReusableAcrossDrafts: null as boolean | null, uploadParametersAccepted: false, httpStatus: null as number | null, productionSourceProven: false };
  if (url.protocol !== "https:" || !["www.mediref.com.au", "mediref.com.au"].includes(url.hostname) || !/^[a-zA-Z0-9_-]+$/.test(prefix) || !/^[a-zA-Z0-9_-]+$/.test(secondDraft) || !firstDraft || firstDraft === secondDraft) return safeResult;
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const suffix = [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
  const key = `${prefix}/${secondDraft}/${suffix}`;
  try {
    const payload = Buffer.from(JSON.stringify([{ key: 1, type: 2, filename: 3 }, key, "application/pdf", "diagnostic.pdf"])).toString("base64");
    const response = await page.request.post(`${url.origin}${routes.upload}`, { data: { payload, refreshes: [] }, timeout: 15000 });
    try {
      safeResult.httpStatus = response.status();
      const length = Number(response.headers()["content-length"]);
      if (!response.ok() || !Number.isFinite(length) || length <= 0 || length > limit) return safeResult;
      const outer = parseJson(await response.text());
      const inner = parseJson(typeof record(outer).result === "string" ? record(outer).result as string : null);
      const destination = Array.isArray(inner) && typeof inner[0] === "string" ? inner[0] : null;
      if (!destination || new URL(destination).protocol !== "https:") return safeResult;
      return { ...safeResult, prefixReusableAcrossDrafts: true, uploadParametersAccepted: true };
    } finally { await response.dispose(); }
  } catch { return safeResult; }
}

// Passive, local-only comparison. Retains no complete key or suffix between requests.
export function startHistoricalPrefixComparison(context: BrowserContext, page: import("playwright").Page, historicalPrefix: string) {
  let firstPrefix: string | null = null;
  let firstDraftFingerprint: string | null = null;
  let currentDraftFingerprint: string | null = null;
  let result: { historicalPrefixMatchesCurrentLivePrefix: boolean; currentSuffixLength: number; currentSuffixLowercaseAlphanumeric: boolean; historicalSuffixAlgorithmCompatible: boolean; livePrefixStableAcrossTwoDrafts?: boolean } | null = null;
  let resolveFirst!: () => void; let resolveSecond!: () => void;
  const first = new Promise<void>(resolve => { resolveFirst = resolve; });
  const second = new Promise<void>(resolve => { resolveSecond = resolve; });
  let chain = Promise.resolve(); let stopped = false;
  const fingerprint = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
  const listener = (request: Request) => {
    if (stopped || result?.livePrefixStableAcrossTwoDrafts !== undefined) return;
    try {
      const url = new URL(request.url());
      if (url.protocol !== "https:" || !["www.mediref.com.au", "mediref.com.au"].includes(url.hostname) || request.frame().page() !== page || url.origin !== new URL(page.url()).origin || request.method() !== "POST") return;
      if (![routes.save, routes.upload].includes(url.pathname)) return;
      const decoded = decodedPayload(record(parseJson(request.postData())).payload);
      // Extract only the relevant scalar; never retain the patient payload in the queue.
      const value = wireValue(decoded, wireRoot(decoded)[url.pathname === routes.save ? "s3uuid" : "key"]);
      if (typeof value !== "string") return;
      const isSave = url.pathname === routes.save;
      chain = chain.then(async () => {
        if (stopped) return;
        if (isSave) { currentDraftFingerprint = await fingerprint(value); return; }
        const parts = value.split("/");
        if (parts.length !== 3 || parts.some(part => !part)) return;
        const draftFingerprint = await fingerprint(parts[1]);
        if (draftFingerprint !== currentDraftFingerprint) return;
        if (!result) {
          firstPrefix = parts[0]; firstDraftFingerprint = draftFingerprint;
          const lowercase = /^[a-z0-9]+$/.test(parts[2]);
          result = { historicalPrefixMatchesCurrentLivePrefix: parts[0] === historicalPrefix, currentSuffixLength: parts[2].length, currentSuffixLowercaseAlphanumeric: lowercase, historicalSuffixAlgorithmCompatible: lowercase && parts[2].length === 24 };
          historicalPrefix = "";
          resolveFirst();
        } else if (draftFingerprint !== firstDraftFingerprint) {
          result.livePrefixStableAcrossTwoDrafts = parts[0] === firstPrefix;
          firstPrefix = null; firstDraftFingerprint = null; currentDraftFingerprint = null;
          context.off("request", listener); resolveSecond();
        }
      }).catch(() => { /* Never expose raw request or parsing errors. */ });
    } catch { /* Ignore detached or foreign frames. */ }
  };
  context.on("request", listener);
  const wait = async (promise: Promise<void>, timeoutMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([promise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("Prefix comparison capture timed out.")), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    waitForFirst: (timeoutMs = 180_000) => wait(first, timeoutMs),
    waitForSecond: (timeoutMs = 180_000) => wait(second, timeoutMs),
    async stop() {
      stopped = true; context.off("request", listener); await chain;
      firstPrefix = null; firstDraftFingerprint = null; currentDraftFingerprint = null; historicalPrefix = "";
      // Missing observations must never be reported as false comparisons.
      return result?.livePrefixStableAcrossTwoDrafts !== undefined ? { ...result } : null;
    },
  };
}
