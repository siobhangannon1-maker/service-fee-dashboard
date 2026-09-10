import { inspectPersistedDraft, limit as pageDataLimit } from "./persisted-draft";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, APIResponse, Page } from "playwright";

const origin = "https://www.mediref.com.au";
const saveRoute = "/_app/remote/fd8vn1/saveDraft";
const uploadRoute = "/_app/remote/1wqh9sd/getUploadParameters";
const timeout = 30_000;
// This account-specific prefix was validated against current live keys across two
// drafts. It is approved only for the existing single-account integration and
// must not be assumed valid for another MediRef account.
const ACCOUNT_UPLOAD_PREFIX = "ayjWHBhgAZyCsJ4fG";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type PdfAttachment = { filename: string; pdf: Buffer };
type Patient = { firstName?: unknown; lastName?: unknown; dob?: unknown };
type Stage = "draft_ready" | "patient_save_started" | "patient_saved" | "upload_parameters_requested" | "upload_parameters_received" | "pdf_upload_started" | "pdf_upload_completed" | "attachment_save_started" | "attachment_saved" | "draft_prepared";
type Logger = (message: string, fields: { attachmentCount?: number; expectedCount?: number; matchedCount?: number; sameDraft?: boolean; filesCollectionPresent?: boolean; attachmentIndex?: number; httpStatus?: number; structuralSuccess?: boolean; allStructurallyComplete?: boolean }) => void;

export class MedirefRemoteDraftError extends Error {
  constructor(public readonly stage: string) { super(stage === "attachment_persistence_verification"
    ? "MediRef attachment persistence could not be verified. The external outcome is uncertain; check MediRef before retrying (stage: attachment_persistence_verification)."
    : `Unable to prepare MediRef remote draft (stage: ${stage}).`); }
}

// The captured wire format is an indexed value table, then base64 JSON. Shared
// primitives reuse indices, including the empty strings in the patient object.
export function flattenRemotePayload(value: Json): Json[] {
  const table: Json[] = [];
  const indices = new Map<Json, number>();
  const add = (item: Json): number => {
    const existing = indices.get(item);
    if (existing !== undefined) return existing;
    const index = table.length; indices.set(item, index); table.push(null);
    table[index] = Array.isArray(item) ? item.map(add) : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, add(child)])) : item;
    return index;
  };
  add(value);
  return table;
}
export function encodeRemotePayload(value: Json) {
  return Buffer.from(JSON.stringify(flattenRemotePayload(value)), "utf8").toString("base64");
}

// Decode only the plain-data result types used by these two remote operations.
// Unsupported tagged objects or malformed references fail closed.
export function decodeRemoteResult(raw: string): unknown {
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("Invalid remote response.");
  const outer: unknown = JSON.parse(raw);
  if (!outer || Array.isArray(outer) || typeof outer !== "object") throw new Error("Invalid remote response.");
  const envelope = outer as Record<string, unknown>;
  if ((envelope.type !== undefined && envelope.type !== "result") || "error" in envelope || typeof envelope.result !== "string") throw new Error("Invalid remote response.");
  const wire: unknown = JSON.parse(envelope.result);
  if (wire === -1 && envelope.type === "result") return undefined;
  if (!Array.isArray(wire) || wire.length === 0 || wire.length > 10000) throw new Error("Invalid remote response.");
  const active = new Set<number>(); const decoded = new Map<number, unknown>();
  const resolve = (ref: unknown, depth = 0): unknown => {
    if (ref === -1) return undefined;
    if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 0 || ref >= wire.length || depth > 40 || active.has(ref)) throw new Error("Invalid remote response.");
    if (decoded.has(ref)) return decoded.get(ref);
    active.add(ref);
    const item: unknown = wire[ref];
    const value = Array.isArray(item) ? item.map(child => resolve(child, depth + 1)) : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, resolve(child, depth + 1)])) : item;
    active.delete(ref); decoded.set(ref, value); return value;
  };
  const result = resolve(0);
  if (result === false || (result && typeof result === "object" && ("error" in result || "errors" in result || ("success" in result && result.success !== true && result.success !== 1) || ("ok" in result && result.ok !== true && result.ok !== 1)))) throw new Error("Remote operation rejected.");
  return result;
}

export function buildPatientDraft(s3uuid: string, patient: Patient) {
  const first = typeof patient.firstName === "string" ? patient.firstName.trim() : "";
  const last = typeof patient.lastName === "string" ? patient.lastName.trim() : "";
  const dob = typeof patient.dob === "string" ? patient.dob : "";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s3uuid) || !first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error("Invalid draft input.");
  const date = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob) throw new Error("Invalid draft input.");
  return {
    s3uuid,
    patient: { name: `${first} ${last}`, dob, ptEmail: "", extraPwType: "none", customPw: "", pwHint: "", ptMsg: "" },
    recipients: [] as Json[], files: [] as Json[], recipientMsg: "",
  };
}
export function makeUploadIdentity(s3uuid: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s3uuid)) throw new Error("Invalid draft identity.");
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const uploadId = Array.from({ length: 24 }, () => chars[randomInt(chars.length)]).join("");
  return { uploadId, key: `${ACCOUNT_UPLOAD_PREFIX}/${s3uuid}/${uploadId}` };
}
export function buildFileMetadata(key: string, uploadId: string, filename: string, size: number, uploadStarted: number) {
  return {
    key, originalName: filename, customName: filename.replace(/\.pdf$/i, ""), ext: ".pdf", type: "application/pdf", size,
    status: "complete", progress: { uploadStarted, bytesUploaded: size, bytesTotal: size, percentage: 100 },
    uploadAttempts: 0, uploadId, s3key: key,
  };
}
export function draftIdFromComposeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== origin) return null;
    return url.pathname.match(/^\/compose\/([a-zA-Z0-9_-]{1,128})\/?$/)?.[1] ?? null;
  } catch { return null; }
}

async function readRemoteResponse(response: APIResponse) {
  if (!response.ok() || !response.headers()["content-type"]?.toLowerCase().includes("application/json")) throw new Error("Remote request failed.");
  return decodeRemoteResult(await response.text());
}
function validatePdfAttachment(attachment: PdfAttachment) {
  if (!attachment.filename || path.basename(attachment.filename) !== attachment.filename || !/\.pdf$/i.test(attachment.filename) || !Buffer.isBuffer(attachment.pdf) || attachment.pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF.");
}

// Only GET is repeated. The overall deadline includes response/body inspection.
const persistenceDeadlineMs = 10_000;
const persistenceCadenceMs = 500;
async function verifyPersistence(request: Pick<APIRequestContext, "get">, draftId: string, files: Json[], log: Logger) {
  const deadline = Date.now() + persistenceDeadlineMs;
  const url = `${origin}/compose/${draftId}/__data.json`;
  log("[MediRef remote] attachment_persistence_started", { attachmentCount: files.length });
  while (Date.now() < deadline) {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remaining = deadline - Date.now();
    const attempt = (async () => {
      const response = await request.get(url, { headers: { accept: "application/json", "cache-control": "no-cache" },
        timeout: Math.min(5000, remaining), maxRedirects: 0 });
      try {
        if (expired) return null;
        // Login/redirect/malformed data are never authentication or persistence proof.
        if (response.status() >= 300 && response.status() < 400 || response.status() === 401 || response.status() === 403) throw new MedirefRemoteDraftError("attachment_persistence_verification");
        if (!response.ok()) return null;
        if (response.url() !== url || (response.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") throw new MedirefRemoteDraftError("attachment_persistence_verification");
        if (Number(response.headers()["content-length"]) > pageDataLimit) throw new MedirefRemoteDraftError("attachment_persistence_verification");
        const body = await response.body();
        if (expired) return null;
        if (body.length > pageDataLimit) throw new MedirefRemoteDraftError("attachment_persistence_verification");
        return inspectPersistedDraft(body.toString("utf8"), draftId, files);
      } finally { await response.dispose().catch(() => undefined); }
    })();
    let sample: ReturnType<typeof inspectPersistedDraft> | null = null;
    try {
      sample = await Promise.race([attempt, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new MedirefRemoteDraftError("attachment_persistence_verification")); }, remaining);
      })]);
    } catch (error) {
      // Never replay any upload/save after an uncertain external outcome.
      if (error instanceof MedirefRemoteDraftError || Date.now() >= deadline) throw new MedirefRemoteDraftError("attachment_persistence_verification");
    } finally { clearTimeout(timer); }
    log("[MediRef remote] attachment_persistence_sample", { expectedCount: files.length,
      matchedCount: sample?.matchedCount ?? 0, sameDraft: sample?.currentDraftRepresented ?? false,
      filesCollectionPresent: sample?.filesCollectionRepresented ?? false });
    if (Date.now() >= deadline) break;
    if (sample?.decodingSupported && sample.currentDraftRepresented && sample.filesCollectionRepresented && sample.attachmentPresent === true) {
      log("[MediRef remote] attachment_persistence_verified", { attachmentCount: files.length }); return;
    }
    if (sample && (!sample.decodingSupported || !sample.currentDraftRepresented)) throw new MedirefRemoteDraftError("attachment_persistence_verification");
    await new Promise(resolve => setTimeout(resolve, Math.min(persistenceCadenceMs, Math.max(0, deadline - Date.now()))));
  }
  throw new MedirefRemoteDraftError("attachment_persistence_verification");
}

export async function prepareRemoteDraft(options: {
  request: Pick<APIRequestContext, "post" | "put" | "get">;
  s3uuid: string; patient: Patient; attachments: PdfAttachment[]; log?: Logger;
}) {
  const log = options.log ?? console.log;
  let stage = "validate_input";
  let attachmentIndex: number | undefined;
  const attachmentCount = options.attachments.length;
  const emit = (next: Stage, httpStatus?: number) => {
    stage = next;
    log(`[MediRef remote] ${next}`, { attachmentCount, ...(attachmentIndex === undefined ? {} : { attachmentIndex }), ...(httpStatus === undefined ? {} : { httpStatus, structuralSuccess: true }) });
  };
  try {
    const draft = buildPatientDraft(options.s3uuid, options.patient);
    if (attachmentCount === 0) throw new Error("At least one PDF is required.");
    for (const [index, attachment] of options.attachments.entries()) {
      attachmentIndex = index;
      validatePdfAttachment(attachment);
    }
    attachmentIndex = undefined;
    const post = async (route: typeof saveRoute | typeof uploadRoute, payload: Json) => {
      const response = await options.request.post(`${origin}${route}`, {
        headers: { origin, referer: `${origin}/compose/${options.s3uuid}`, "x-sveltekit-pathname": `/compose/${options.s3uuid}`, "x-sveltekit-search": "" },
        data: { payload: encodeRemotePayload(payload), refreshes: [] }, timeout, maxRedirects: 0,
      });
      try { return { value: await readRemoteResponse(response), status: response.status() }; }
      finally { await response.dispose(); }
    };
    emit("draft_ready"); emit("patient_save_started");
    const patientSave = await post(saveRoute, draft); emit("patient_saved", patientSave.status);
    const usedUploadIds = new Set<string>();
    for (const [index, attachment] of options.attachments.entries()) {
      attachmentIndex = index;
      const { key, uploadId } = makeUploadIdentity(options.s3uuid);
      if (usedUploadIds.has(uploadId)) throw new Error("Duplicate upload identity.");
      usedUploadIds.add(uploadId);
      emit("upload_parameters_requested");
      const parameters = await post(uploadRoute, { key, type: "application/pdf", filename: attachment.filename });
      if (typeof parameters.value !== "string") throw new Error("Invalid upload destination.");
      const destination = new URL(parameters.value);
      if (destination.protocol !== "https:" || destination.username || destination.password || destination.hash || destination.origin === origin) throw new Error("Invalid upload destination.");
      emit("upload_parameters_received", parameters.status);
      emit("pdf_upload_started"); const uploadStarted = Date.now();
      const uploaded = await options.request.put(destination.href, { headers: { "content-type": "application/pdf" }, data: attachment.pdf, timeout, maxRedirects: 0 });
      try { if (!uploaded.ok()) throw new Error("PDF upload failed."); emit("pdf_upload_completed", uploaded.status()); }
      finally { await uploaded.dispose(); }
      draft.files.push(buildFileMetadata(key, uploadId, attachment.filename, attachment.pdf.length, uploadStarted));
    }
    attachmentIndex = undefined;
    const allStructurallyComplete = draft.files.length === attachmentCount && draft.files.every((file, index) => {
      const f = file as ReturnType<typeof buildFileMetadata>;
      const a = options.attachments[index];
      return f.originalName === a.filename && f.customName === a.filename.replace(/\.pdf$/i, "") &&
        f.ext === ".pdf" && f.type === "application/pdf" && f.size === a.pdf.length && f.size > 0 &&
        f.status === "complete" && f.uploadAttempts === 0 && typeof f.uploadId === "string" &&
        /^[a-z0-9]{24}$/.test(f.uploadId) && typeof f.key === "string" && f.s3key === f.key &&
        f.key.endsWith(`/${options.s3uuid}/${f.uploadId}`) &&
        f.progress.bytesUploaded === f.size && f.progress.bytesTotal === f.size && f.progress.percentage === 100 &&
        Number.isFinite(f.progress.uploadStarted);
    });
    log("[MediRef remote] attachment_metadata_ready", { attachmentCount, allStructurallyComplete });
    if (!allStructurallyComplete) throw new Error("Incomplete attachment metadata.");
    emit("attachment_save_started");
    const attachmentSave = await post(saveRoute, draft); emit("attachment_saved", attachmentSave.status);
    stage = "attachment_persistence_verification";
    await verifyPersistence(options.request, options.s3uuid, draft.files, log);
    emit("draft_prepared");
    return { prepared: true, sent: false, autoSend: false, recipientMatchingSkipped: true, attachmentCount, remoteDraftSaved: true, message: "MediRef draft prepared with patient details and PDF attachment. Recipient matching and final Send were skipped." };
  } catch {
    // Discard raw Playwright/HTTP errors: they can contain patient payloads and signed URLs.
    if (attachmentIndex !== undefined) log("[MediRef remote] attachment_upload_failed", { attachmentIndex, attachmentCount });
    throw new MedirefRemoteDraftError(stage);
  }
}

export async function prepareRemoteDraftWithBrowser(page: Page, patient: Patient, localPdfPaths: string[], openCompose: () => Promise<void>, retryDiagnostic?: { jobId: string }) {
  let stage = "validate_attachment";
  try {
    if (localPdfPaths.length === 0) throw new Error("At least one PDF is required.");
    const attachments: PdfAttachment[] = [];
    for (const [attachmentIndex, localPath] of localPdfPaths.entries()) {
      try {
        const attachment = { filename: path.basename(localPath), pdf: await readFile(localPath) };
        validatePdfAttachment(attachment);
        attachments.push(attachment);
      } catch {
        console.log("[MediRef remote] attachment_upload_failed", { attachmentIndex, attachmentCount: localPdfPaths.length });
        throw new Error("Invalid PDF attachment.");
      }
    }
    // Validate every file before opening or saving anything in MediRef.
    buildPatientDraft("validation", patient);
    stage = "compose_identity";
    await openCompose();
    await page.waitForURL(url => draftIdFromComposeUrl(url.href) !== null, { timeout: 15_000, waitUntil: "domcontentloaded" });
    const s3uuid = draftIdFromComposeUrl(page.url());
    if (!s3uuid) throw new Error("Draft identity unavailable.");
    return await prepareRemoteDraft({ request: page.context().request, s3uuid, patient, attachments,
      log: retryDiagnostic ? (message, fields) => console.log(message, { jobId: retryDiagnostic.jobId, ...fields }) : undefined });
  } catch (error) {
    throw error instanceof MedirefRemoteDraftError ? error : new MedirefRemoteDraftError(stage);
  }
}
