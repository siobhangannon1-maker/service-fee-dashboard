export const DICTATION_MAX_BYTES = 24_000_000;
export type DictationContext = {
  providerId: string;
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  editorKey: string;
  draftId: string | null;
  recordingId: string;
};
export function contextKey(context: DictationContext): string {
  return JSON.stringify([
    context.providerId,
    context.patientFirstName.trim(),
    context.patientLastName.trim(),
    context.patientDob,
    context.editorKey,
    context.draftId,
    context.recordingId,
  ]);
}
export class DictationUploadError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/m4a": "m4a",
};
