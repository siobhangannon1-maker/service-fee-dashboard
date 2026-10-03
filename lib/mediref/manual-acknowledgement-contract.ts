export const manuallyAcknowledgedMessage = 'This letter was manually acknowledged as sent. Automated MediRef execution is blocked.';
export class MedirefAcknowledgementError extends Error {
  readonly code = 'manually_acknowledged';
  constructor() { super(manuallyAcknowledgedMessage); }
}
// The DB protects this draft-level marker permanently, including after edits.
export function hasMedirefAcknowledgement(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const entry = (response as { manualVerification?: { mediref?: { source?: unknown; recoveryClass?: unknown } } }).manualVerification?.mediref;
  return entry?.source === 'manually_sent' && entry.recoveryClass === 'no_prior_helper_job_v1';
}
