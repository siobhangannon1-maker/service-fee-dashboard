import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  AUDIO_TYPES,
  contextKey,
  DICTATION_MAX_BYTES,
  DictationContext,
  DictationUploadError,
} from "./dictation-upload-contract";
export type AudioReference = {
  version: 1;
  ownerId: string;
  context: DictationContext;
  path: string;
  size: number;
  mime: string;
  sha256: string;
  expires: number;
};
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export function parseDictationContext(input: unknown): DictationContext {
  const c = input as DictationContext;
  if (
    !c ||
    !uuid(c.providerId) ||
    !uuid(c.recordingId) ||
    (c.draftId !== null && !uuid(c.draftId)) ||
    typeof c.patientDob !== "string" ||
    c.patientDob.length > 30 ||
    typeof c.editorKey !== "string" ||
    c.editorKey.length > 100 ||
    typeof c.patientFirstName !== "string" ||
    typeof c.patientLastName !== "string" ||
    !c.patientFirstName.trim() ||
    !c.patientLastName.trim() ||
    c.patientFirstName.length > 150 ||
    c.patientLastName.length > 150
  )
    throw new DictationUploadError(
      "INVALID_CONTEXT",
      "Enter the patient details before dictating.",
    );
  return {
    providerId: c.providerId,
    patientDob: c.patientDob,
    editorKey: c.editorKey,
    patientFirstName: c.patientFirstName.trim(),
    patientLastName: c.patientLastName.trim(),
    draftId: c.draftId,
    recordingId: c.recordingId,
  };
}
function signature(payload: string, secret: string) {
  if (!secret) throw new Error("Signing unavailable");
  return createHmac("sha256", secret)
    .update("provider-dictation-upload:v1\0" + payload)
    .digest();
}
export function signAudioReference(reference: AudioReference, secret: string) {
  const payload = Buffer.from(JSON.stringify(reference)).toString("base64url");
  return payload + "." + signature(payload, secret).toString("base64url");
}
export function createAudioReference(
  ownerId: string,
  context: DictationContext,
  size: number,
  mime: string,
  sha256: string,
  now = Date.now(),
): AudioReference {
  const type = mime.split(";")[0].trim();
  if (
    !uuid(ownerId) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > DICTATION_MAX_BYTES ||
    !Object.hasOwn(AUDIO_TYPES, type) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new DictationUploadError(
      "INVALID_AUDIO",
      "Recording must be a supported audio file below 24 MB. Download and keep the recording.",
    );
  return {
    version: 1,
    ownerId,
    context: parseDictationContext(context),
    path: `provider-dictation/${ownerId}/${randomUUID()}/audio.${AUDIO_TYPES[type]}`,
    size,
    mime: type,
    sha256,
    expires: now + 24 * 60 * 60 * 1000,
  };
}
export function verifyAudioReference(
  token: unknown,
  ownerId: string,
  context: DictationContext,
  secret: string,
  now = Date.now(),
): AudioReference {
  const denied = () =>
    new DictationUploadError(
      "AUDIO_ACCESS_DENIED",
      "This recording belongs to a different user, patient or draft, or its reference has expired.",
      403,
    );
  if (typeof token !== "string" || token.length > 6000) throw denied();
  const [payload, mac, ...extra] = token.split(".");
  if (!payload || !mac || extra.length) throw denied();
  const provided = Buffer.from(mac, "base64url"),
    expected = signature(payload, secret);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    throw denied();
  let r: AudioReference;
  try {
    r = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw denied();
  }
  if (
    r.version !== 1 ||
    r.ownerId !== ownerId ||
    !Number.isFinite(r.expires) ||
    r.expires <= now ||
    contextKey(parseDictationContext(r.context)) !== contextKey(context) ||
    !r.path.startsWith(`provider-dictation/${ownerId}/`) ||
    r.path.includes("..") ||
    r.size < 1 ||
    r.size > DICTATION_MAX_BYTES
  )
    throw denied();
  return r;
}
