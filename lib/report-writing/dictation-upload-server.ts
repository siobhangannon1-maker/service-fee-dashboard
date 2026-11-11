import "server-only";
import { createHash } from "node:crypto";
import { requireActiveApiUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DictationContext,
  DictationUploadError,
} from "./dictation-upload-contract";
import {
  AudioReference,
  parseDictationContext,
  verifyAudioReference,
} from "./dictation-upload-token";
export const DICTATION_BUCKET = "report-assets";
export async function authorisedDictationContext(input: unknown) {
  const context = parseDictationContext(input);
  const { user } = await requireActiveApiUser();
  // Provider Letters is a linked-provider page. A privileged role alone does not grant another provider's audio.
  const { data, error } = await supabaseAdmin
    .from("providers")
    .select("id")
    .eq("id", context.providerId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data)
    throw new DictationUploadError(
      "PROVIDER_ACCESS_DENIED",
      "This recording is not available to this provider.",
      403,
    );
  if (context.draftId) {
    const draft = await supabaseAdmin
      .from("report_drafts")
      .select("id,patient_name,patient_dob")
      .eq("id", context.draftId)
      .eq("provider_id", context.providerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (
      draft.error ||
      !draft.data ||
      (draft.data.patient_dob || "") !== context.patientDob ||
      draft.data.patient_name?.trim() !==
        `${context.patientFirstName} ${context.patientLastName}`
    )
      throw new DictationUploadError(
        "DRAFT_CONTEXT_CHANGED",
        "The selected draft no longer matches this recording. Your audio has been kept.",
        409,
      );
  }
  return { context, ownerId: user.id };
}
export async function boundedJson(
  req: Request,
): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader)
    throw new DictationUploadError("INVALID_REQUEST", "Missing request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new DictationUploadError(
        "REQUEST_TOO_LARGE",
        "Send the audio directly to Storage.",
        413,
      );
    }
    chunks.push(part.value);
  }
  try {
    const bytes = Buffer.concat(chunks);
    const data = JSON.parse(bytes.toString("utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object") throw Error();
    return data;
  } catch {
    throw new DictationUploadError("INVALID_REQUEST", "Invalid request.");
  }
}
export function sameOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    throw new DictationUploadError(
      "ORIGIN_DENIED",
      "Request origin not permitted.",
      403,
    );
}
export async function referenceFor(input: Record<string, unknown>) {
  const actor = await authorisedDictationContext(input.context);
  return verifyAudioReference(
    input.reference,
    actor.ownerId,
    actor.context,
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  );
}
export async function retrieveDictationAudio(
  reference: AudioReference,
): Promise<File> {
  const info = await supabaseAdmin.storage
    .from(DICTATION_BUCKET)
    .info(reference.path);
  if (info.error) {
    if (
      String(info.error.statusCode) === "404" ||
      String(info.error.statusCode) === "400"
    )
      throw new DictationUploadError(
        "AUDIO_NOT_UPLOADED",
        "Audio upload has not completed. Retry upload; your recording is still available.",
        404,
      );
    throw new DictationUploadError(
      "STORAGE_UNAVAILABLE",
      "Audio storage is unavailable. Retry transcription shortly.",
      503,
    );
  }
  if (Number(info.data.size) !== reference.size)
    throw new DictationUploadError(
      "AUDIO_MISMATCH",
      "The uploaded audio could not be verified. Download and keep your recording.",
      409,
    );
  const signed = await supabaseAdmin.storage
    .from(DICTATION_BUCKET)
    .createSignedUrl(reference.path, 60);
  if (signed.error)
    throw new DictationUploadError(
      "STORAGE_UNAVAILABLE",
      "Could not retrieve the recording. Retry shortly.",
      503,
    );
  const response = await fetch(signed.data.signedUrl, {
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw new DictationUploadError(
      "STORAGE_UNAVAILABLE",
      "Could not retrieve the recording. Retry shortly.",
      503,
    );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > reference.size) {
      await reader.cancel();
      throw new DictationUploadError(
        "AUDIO_MISMATCH",
        "The uploaded audio has changed.",
        409,
      );
    }
    chunks.push(part.value);
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== reference.size ||
    createHash("sha256").update(bytes).digest("hex") !== reference.sha256
  )
    throw new DictationUploadError(
      "AUDIO_MISMATCH",
      "The uploaded audio could not be verified. Keep your original recording.",
      409,
    );
  return new File([bytes], "dictation." + reference.path.split(".").pop(), {
    type: reference.mime,
  });
}
