import type { BrowserContext, Page, Request } from "playwright";

const origin = "https://www.mediref.com.au";
const savePath = "/_app/remote/fd8vn1/saveDraft";
import { limit, fields, object, kind, fail, decodeTable, parse, identity, matches, inspectPersistedDraft } from "../lib/mediref/persisted-draft";
export function composeIdentity(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.origin === origin && !u.search && !u.hash ? u.pathname.match(/^\/compose\/([A-Za-z0-9_-]{1,128})\/?$/)?.[1] ?? null : null;
  } catch { return null; }
}

// All labels below are fixed allowlists, never dynamically copied response text.
const safeFields = new Set([...fields, "s3uuid", "files", "patient", "recipients", "draft", "data", "nodes", "uses", "slash", "error"]);
const tagNames = ["Date", "null", "Set", "Map", "BigInt", "RegExp", "Object", "Promise", "URL", "URLSearchParams", "ArrayBuffer"];
export function classifyPageTransport(raw: string) {
  const report = { topLevelType: "unavailable", arrayCount: 0, objectCount: 0, maxDepthObserved: 0, truncated: false,
    nodeTypeCounts: {} as Record<string, number>, tagTypeCounts: {} as Record<string, number>,
    safeFieldCounts: {} as Record<string, number>, unknownFieldCount: 0,
    markers: { dataEnvelope: false, nodesArray: false, skipNode: false, taggedTable: false, specialReferences: false },
    references: { tableCount: 0, validIndexCount: 0, invalidIndexCount: 0, repeatedIndexCount: 0, sentinelCount: 0 } };
  const count = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const field = (key: string) => { if (safeFields.has(key)) count(report.safeFieldCounts, key); else report.unknownFieldCount++; };
  try {
    const outer = parse(raw); report.topLevelType = kind(outer);
    let visited = 0;
    const walk = (value: unknown, depth = 0) => {
      if (++visited > 20000 || depth > 40) { report.truncated = true; return; }
      report.maxDepthObserved = Math.max(report.maxDepthObserved, depth);
      if (Array.isArray(value)) { report.arrayCount++; value.forEach(v => walk(v, depth + 1)); }
      else if (object(value)) { report.objectCount++; Object.entries(value).forEach(([k, v]) => {field(k); walk(v, depth + 1);}); }
    };
    walk(outer);
    report.markers.dataEnvelope = object(outer) && outer.type === "data";
    report.markers.nodesArray = object(outer) && Array.isArray(outer.nodes);
    if (object(outer) && Array.isArray(outer.nodes)) for (const node of outer.nodes.slice(0, 1000)) {
      const type = node === null ? "null" : object(node) && ["data", "skip", "error", "redirect"].includes(String(node.type)) ? String(node.type) : "unknown";
      count(report.nodeTypeCounts, type); report.markers.skipNode ||= type === "skip";
      if (!object(node)) continue;
      if (typeof node.data === "number" && node.data < 0) {report.references.sentinelCount++; report.markers.specialReferences = true;}
      if (!Array.isArray(node.data)) continue;
      report.references.tableCount++;
      const tableLength = node.data.length;
      const seen = new Set<number>();
      const ref = (value: unknown) => {
        if (typeof value === "number" && Number.isInteger(value) && value >= -6 && value < 0) {report.references.sentinelCount++;report.markers.specialReferences = true;}
        else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < tableLength) {
          report.references.validIndexCount++; if (seen.has(value)) report.references.repeatedIndexCount++; seen.add(value);
        } else report.references.invalidIndexCount++;
      };
      for (const item of node.data.slice(0, 10000)) {
        if (Array.isArray(item) && typeof item[0] === "string") {
          report.markers.taggedTable = true; count(report.tagTypeCounts, tagNames.includes(item[0]) ? item[0] : "unknown");
          if (item[0] === "null") for (let i = 1; i < item.length; i += 2) {if (typeof item[i] === "string") field(item[i]); ref(item[i + 1]);}
          else if (["Set", "Map", "Promise", "Object"].includes(item[0])) item.slice(1).forEach(ref);
        } else if (Array.isArray(item)) item.forEach(ref);
        else if (object(item)) Object.values(item).forEach(ref);
      }
    }
  } catch { /* Fixed structural summary only, including invalid/oversized input. */ }
  return report;
}
export function inspectPageData(raw: string, draftId: string, expected: unknown[]) {
  return { transport: classifyPageTransport(raw), ...inspectPersistedDraft(raw, draftId, expected) };
}

export function inspectSave(raw: string, draftId: string) {
  try {
    const body = parse(raw);
    if (!object(body) || typeof body.payload !== "string" || body.payload.length > limit || !/^[A-Za-z0-9+/=_-]+$/.test(body.payload)) return null;
    const draft = decodeTable(parse(Buffer.from(body.payload, "base64").toString("utf8")));
    if (!object(draft) || draft.s3uuid !== draftId) return null;
    // Returned values stay private to the observer. Never log this return value.
    return { files: Array.isArray(draft.files) ? draft.files : null };
  } catch { return null; }
}

export function startPersistenceDiagnostic(context: BrowserContext, page: Page) {
  const candidateId = composeIdentity(page.url());
  if (!candidateId) throw fail();
  const draftId: string = candidateId;
  let uploadedKey: string | null = null;
  let expected: unknown[] = []; let baseline: unknown[] = []; let later = false; let stopped = false; let finishing = false;
  let observed = 0; let dropped = false;
  const laterSaves: Array<{ laterSaveObserved: boolean; laterSaveContainsFiles: boolean; laterSaveFileCount: number | null; laterSaveMatchesPreviouslyObservedFileIdentity: boolean }> = [];
  const listener = (request: Request) => {
    try {
      if (request.frame().page() !== page || request.method() !== "POST") return;
      const url = new URL(request.url());
      if (url.origin !== origin) return;
      if (!later && url.pathname === "/_app/remote/1wqh9sd/getUploadParameters") {
        const body = parse(request.postData() ?? "");
        if (object(body) && typeof body.payload === "string" && body.payload.length <= limit) {
          const upload = decodeTable(parse(Buffer.from(body.payload, "base64").toString("utf8")));
          if (object(upload) && typeof upload.key === "string" && upload.key.split("/").includes(draftId)) uploadedKey = upload.key;
        }
        return;
      }
      if (url.pathname !== savePath) return;
      if (++observed > 100) { dropped = true; return; }
      const save = inspectSave(request.postData() ?? "", draftId);
      if (!save) return;
      if (!later) { if (uploadedKey && save.files?.length === 1 && identity(save.files[0])?.key === uploadedKey) expected = save.files; return; }
      laterSaves.push({ laterSaveObserved: true, laterSaveContainsFiles: save.files !== null,
        laterSaveFileCount: save.files?.length ?? null, laterSaveMatchesPreviouslyObservedFileIdentity: save.files !== null && matches(save.files, baseline) });
    } catch { dropped = true; }
  };
  context.on("request", listener);
  const stop = () => { stopped = true; context.off("request", listener); clearTimeout(lifetime); expected = []; baseline = []; uploadedKey = null; };
  // Manual input is allowed five minutes. Expiry removes listeners/private state.
  const lifetime = setTimeout(stop, 300_000);
  async function read() {
    const result = { httpStatus: null as number | null, contentType: "unavailable", sameDraftPage: composeIdentity(page.url()) === draftId,
      state: null as ReturnType<typeof inspectPageData> | null, reason: "read_unavailable" };
    if (stopped || !result.sameDraftPage) return result;
    let response: Awaited<ReturnType<typeof context.request.get>> | undefined;
    let expired = false; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = (async () => {
        response = await context.request.get(`${origin}/compose/${draftId}/__data.json`, {
          headers: { accept: "application/json", "cache-control": "no-cache" }, timeout: 5000, maxRedirects: 0,
        });
        try {
          if (expired) return;
          result.httpStatus = response.status();
          const mime = (response.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase();
          result.contentType = mime === "application/json" ? mime : "other";
          if (!response.ok() || result.contentType !== "application/json" || response.url() !== `${origin}/compose/${draftId}/__data.json`) return;
          const declared = response.headers()["content-length"];
          if (declared && Number(declared) > limit) { result.reason = "oversized"; return; }
          const body = await response.body();
          if (expired) return;
          if (body.length > limit) { result.reason = "oversized"; return; }
          result.state = inspectPageData(body.toString("utf8"), draftId, baseline); result.reason = "captured";
        } finally { await response.dispose().catch(() => undefined); }
      })();
      await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(fail()); }, 5500); })]);
    } catch { result.reason = "read_failed_or_timeout"; }
    finally { clearTimeout(timer); }
    return result;
  }
  return {
    stop,
    async finish() {
      if (stopped || finishing) throw fail(); finishing = true;
      baseline = expected; later = true;
      try {
        const initial = await read();
        const afterInitial = laterSaves.length;
        await new Promise(resolve => setTimeout(resolve, 12000));
        const final = await read();
        const first = initial.state?.attachmentPresent ?? null; const last = final.state?.attachmentPresent ?? null;
        return { initial, final, laterSaves: [...laterSaves], savesDuringInitialRead: afterInitial, observationComplete: !stopped && !dropped && composeIdentity(page.url()) === draftId,
          initialReadAttachmentPresent: first, laterSaveObserved: laterSaves.length > 0, finalReadAttachmentPresent: last,
          attachmentPersistedAcrossObservation: first === null || last === null ? null : first && last,
          interpretation: stopped || dropped || first === null || last === null ? "D_inconclusive" : first && last ? "A_present_at_both_reads" :
            first && !last && laterSaves.some(s => !s.laterSaveMatchesPreviouslyObservedFileIdentity) ? "B_loss_with_intervening_save_not_proven_causal" :
            !first && !last ? "C_absent_at_both_reads" : "D_inconclusive" };
      } finally { stop(); }
    },
  };
}
