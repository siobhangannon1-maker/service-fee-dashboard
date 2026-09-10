// Shared pure parsing for production verification and local diagnostics. No I/O.
export const limit = 256 * 1024;
export const fields = ["originalName", "customName", "ext", "type", "size", "status", "progress", "uploadAttempts", "uploadId", "key", "s3key"];
type RecordValue = Record<string, unknown>;
export const object = (v: unknown): v is RecordValue => v !== null && typeof v === "object" && !Array.isArray(v);
export const kind = (v: unknown) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
export const fail = () => new Error("Persistence diagnostic data unavailable.");

// Restricted structural decoder, not a general devalue reviver. Never instantiate
// payload-selected constructors. Date values are opaque and cannot match identity.
const opaqueDate = Symbol("opaque_date");
class TransportError extends Error {
  constructor(readonly category: "invalid_reference" | "cyclic_reference" | "unknown_tag" | "malformed_tag" | "unsupported_node" | "bounds_exceeded") { super("Transport inspection unavailable."); }
}
export function decodeTable(table: unknown): unknown {
  const special = (ref: number): unknown => {
    if (ref === -1) return undefined;
    if (ref === -3) return NaN;
    if (ref === -4) return Infinity;
    if (ref === -5) return -Infinity;
    if (ref === -6) return -0;
    throw new TransportError("invalid_reference");
  };
  if (typeof table === "number") return special(table);
  if (!Array.isArray(table) || !table.length || table.length > 10000) throw new TransportError("bounds_exceeded");
  const active = new Set<number>(); const cache = new Map<number, unknown>();
  let visited = 0;
  const resolve = (ref: unknown, depth = 0): unknown => {
    if (++visited > 20000 || depth > 40) throw new TransportError("bounds_exceeded");
    if (typeof ref === "number" && ref < 0) return special(ref);
    if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 0 || ref >= table.length) throw new TransportError("invalid_reference");
    if (active.has(ref)) throw new TransportError("cyclic_reference");
    if (cache.has(ref)) return cache.get(ref);
    active.add(ref);
    const item = table[ref];
    let result: unknown;
    if (Array.isArray(item) && typeof item[0] === "string") {
      if (item[0] === "Date") {
        if (item.length !== 2 || typeof item[1] !== "string") throw new TransportError("malformed_tag");
        result = opaqueDate;
      } else if (item[0] === "null") {
        if (item.length % 2 !== 1) throw new TransportError("malformed_tag");
        const entries: Array<[string, unknown]> = []; const seen = new Set<string>();
        for (let i = 1; i < item.length; i += 2) {
          if (typeof item[i] !== "string" || item[i] === "__proto__" || seen.has(item[i])) throw new TransportError("malformed_tag");
          seen.add(item[i]); entries.push([item[i], resolve(item[i + 1], depth + 1)]);
        }
        result = Object.fromEntries(entries);
      } else throw new TransportError("unknown_tag");
    } else if (Array.isArray(item)) {
      result = item.map(v => v === -2 ? undefined : resolve(v, depth + 1));
    } else if (object(item)) {
      if (Object.hasOwn(item, "__proto__")) throw new TransportError("malformed_tag");
      result = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, resolve(v, depth + 1)]));
    } else result = item;
    active.delete(ref); cache.set(ref, result); return result;
  };
  return resolve(0);
}

export function parse(raw: string): unknown {
  if (Buffer.byteLength(raw) > limit) throw fail();
  try { return JSON.parse(raw); } catch { throw fail(); }
}
export function identity(file: unknown) {
  if (!object(file)) return null;
  if (file.uploadId !== undefined && (typeof file.uploadId !== "string" || !file.uploadId)) return null;
  const key = typeof file.key === "string" && file.key ? file.key : typeof file.s3key === "string" && file.s3key ? file.s3key : null;
  if (file.key !== undefined && file.s3key !== undefined && file.key !== file.s3key) return null;
  return key ? { key, uploadId: typeof file.uploadId === "string" ? file.uploadId : null } : null;
}
function matchedFiles(files: unknown[], expected: unknown[]) {
  if (!expected.length) return 0;
  const used = new Set<number>();
  return expected.filter(e => {
    const wanted = identity(e); if (!wanted) return false;
    const index = files.findIndex((f, i) => {
      const actual = identity(f);
      return !used.has(i) && actual?.key === wanted.key &&
        (actual.uploadId === null || wanted.uploadId === null || actual.uploadId === wanted.uploadId);
    });
    if (index < 0) return false; used.add(index); return true;
  }).length;
}
function structure(files: unknown[]) {
  return files.map(file => object(file) ? Object.fromEntries(fields.filter(k => k in file).map(k => [k, kind(file[k])])) : { invalidFile: true });
}


export function matches(files: unknown[], expected: unknown[]) { return expected.length > 0 && matchedFiles(files, expected) === expected.length; }
export function inspectPersistedDraft(raw: string, draftId: string, expected: unknown[]) {
  const result = { validSvelteKitPageData: false, decodingSupported: false, currentDraftRepresented: false,
    matchedCount: 0, filesCollectionRepresented: false, filesLocations: [] as string[], persistedFileCount: null as number | null, fileStructure: [] as ReturnType<typeof structure>,
    expectedIdentityAvailable: expected.length > 0 && expected.every(f => identity(f) !== null),
    attachmentPresent: null as boolean | null, reason: "invalid_page_data" };
  try {
    const outer = parse(raw);
    if (!object(outer) || outer.type !== "data" || !Array.isArray(outer.nodes)) return result;
    result.validSvelteKitPageData = true;
    const candidates: RecordValue[] = [];
    let visited = 0;
    const walk = (value: unknown, depth = 0, location = "node") => {
      if (++visited > 20000 || depth > 40) throw fail();
      if (Array.isArray(value)) { value.forEach((v, i) => walk(v, depth + 1, `${location}[${i}]`)); return; }
      if (!object(value)) return;
      if (value.s3uuid === draftId) { result.currentDraftRepresented = true; if (Array.isArray(value.files)) { candidates.push(value); result.filesLocations.push(`${location}.files`); } }
      Object.entries(value).forEach(([key, v]) => walk(v, depth + 1, `${location}.${["draft", "data", "correspondence", "patient", "files"].includes(key) ? key : "[field]"}`));
    };
    for (const [index, node] of outer.nodes.entries()) {
      if (node === null) continue;
      if (object(node) && node.type === "skip") continue;
      if (!object(node) || node.type !== "data") throw new TransportError("unsupported_node");
      walk(decodeTable(node.data), 0, `nodes[${index}].data`);
    }
    result.decodingSupported = true;
    if (candidates.length !== 1) { result.reason = candidates.length > 1 ? "ambiguous_draft_data" : "draft_files_unavailable"; return result; }
    const files = candidates[0].files as unknown[];
    result.filesCollectionRepresented = true; result.persistedFileCount = files.length; result.fileStructure = structure(files);
    result.matchedCount = result.expectedIdentityAvailable ? matchedFiles(files, expected) : 0;
    result.attachmentPresent = result.expectedIdentityAvailable ? matches(files, expected) : null;
    result.reason = result.expectedIdentityAvailable ? "captured" : "expected_identity_unavailable";
  } catch (error) { result.reason = error instanceof TransportError ? error.category : "unsupported_or_invalid_data"; }
  return result;
}
