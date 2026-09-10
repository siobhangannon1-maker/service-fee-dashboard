// The existing patient-filing consumer reads patient_communication.iFileId.
// HTTP success, empty JSON, or a queued job is not evidence of a saved file.
export function isConfirmedPraktikaUpload(response: unknown): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const result = response as Record<string, unknown>;
  if (result.error || result.errors || result.success === false) return false;
  const communication = result.patient_communication;
  if (!communication || typeof communication !== "object" || Array.isArray(communication)) return false;
  const id = (communication as Record<string, unknown>).iFileId;
  return (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
    (typeof id === "string" && /^[1-9]\d*$/.test(id));
}
