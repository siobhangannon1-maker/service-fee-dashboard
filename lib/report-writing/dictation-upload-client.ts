import {
  contextKey,
  DICTATION_MAX_BYTES,
  DictationContext,
  DictationUploadError,
} from "./dictation-upload-contract";
export type RetainedRecording = {
  audio: Blob;
  context: DictationContext;
  reference?: string;
  sha256?: string;
  uploaded: boolean;
};
type ApiResult = {
  success: boolean;
  error?: string;
  code?: string;
  text?: string;
  reference?: string;
  signedUrl?: string;
};
async function request(url: string, input: unknown): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new DictationUploadError(
      "NETWORK_FAILED",
      "Connection interrupted. Your recording is kept on this page. Retry or download it.",
    );
  }
  let result: ApiResult;
  try {
    result = await response.json();
  } catch {
    throw new DictationUploadError(
      "SERVER_UNAVAILABLE",
      `The server did not complete transcription (${response.status}). Your recording is kept. Retry or download it.`,
    );
  }
  if (!response.ok || !result.success)
    throw new DictationUploadError(
      result.code || "REQUEST_FAILED",
      result.error || "The operation failed. Your recording is kept.",
      response.status,
    );
  return result;
}
/** Mutates only this retained take's transport state. Never writes to an editor. */
export async function transcribeRetained(
  recording: RetainedRecording,
  currentContext: DictationContext,
) {
  if (contextKey(recording.context) !== contextKey(currentContext))
    throw new DictationUploadError(
      "CONTEXT_CHANGED",
      "Return to the original patient and draft to retry. Your recording is kept.",
    );
  if (!recording.audio.size || recording.audio.size > DICTATION_MAX_BYTES)
    throw new DictationUploadError(
      "AUDIO_TOO_LARGE",
      "This recording is empty or exceeds 24 MB. Download and keep it; no letter text has been changed.",
    );
  const transcribe = () =>
    request("/api/report-writing/transcribe", {
      reference: recording.reference,
      context: recording.context,
    });
  if (recording.reference) {
    try {
      const result = await transcribe();
      recording.uploaded = true;
      return result.text || "";
    } catch (error) {
      if (
        !(error instanceof DictationUploadError) ||
        error.code !== "AUDIO_NOT_UPLOADED"
      )
        throw error;
      recording.uploaded = false;
    }
  }
  recording.sha256 ??= Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        await recording.audio.arrayBuffer(),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const upload = await request("/api/report-writing/dictation-upload", {
    context: recording.context,
    reference: recording.reference,
    size: recording.audio.size,
    mime: recording.audio.type,
    sha256: recording.sha256,
  });
  if (!upload.reference || !upload.signedUrl)
    throw new DictationUploadError(
      "UPLOAD_UNAVAILABLE",
      "Could not prepare upload. Your recording is kept.",
    );
  recording.reference = upload.reference;
  let response: Response;
  try {
    response = await fetch(upload.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": recording.audio.type, "x-upsert": "false" },
      body: recording.audio,
    });
  } catch {
    throw new DictationUploadError(
      "UPLOAD_INTERRUPTED",
      "Audio upload was interrupted. Retry will check whether it arrived. Keep this page open or download your recording.",
    );
  }
  // Duplicate/replayed upload may already exist: server hash verification is authoritative.
  if (!response.ok && ![400, 409].includes(response.status))
    throw new DictationUploadError(
      "UPLOAD_FAILED",
      "The audio upload failed. Retry or download your recording.",
    );
  const result = await transcribe();
  recording.uploaded = true;
  return result.text || "";
}
