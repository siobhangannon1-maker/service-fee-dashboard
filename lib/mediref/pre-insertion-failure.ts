// Trusted in-process enqueue diagnostics only; never inferred from missing jobs or error strings.
const safeStages = ['patient_validation', 'pdf_generation', 'pdf_validation', 'storage_upload', 'storage_verification', 'attachment_validation'];
export function safePreInsertionFailure(value: Record<string, unknown>) {
  const stage = value.stage;
  if (typeof stage !== 'string' || !safeStages.includes(stage) || value.insertionOutcome !== 'not_attempted'
    || value.deadlineExceeded !== false || value.code !== `MEDIREF_${stage.toUpperCase()}_FAILED`) return null;
  return { contract: 'mediref-no-job-failure-v1', insertionOutcome: 'not_attempted', externalExecution: 'not_started',
    deadlineExceeded: false, stage, code: value.code };
}
