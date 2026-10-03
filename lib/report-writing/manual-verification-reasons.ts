export function manualVerificationReason(code: unknown): string {
  switch (code) {
    case 'active_work': return 'MediRef or workflow work is still queued or running. Completion cannot be acknowledged yet.';
    case 'uncertain_execution': return 'The earlier execution outcome is uncertain. An operator must reconcile it before completion can be acknowledged.';
    case 'missing_safe_evidence': return 'The records do not prove that MediRef preparation stopped safely before execution. Further review is required.';
    case 'state_changed': case 'not_current_attempt': return 'The letter or workflow changed. Check again before confirming.';
    case 'historical_review_required': return 'This historical workflow requires its existing historical review process.';
    case 'not_authorized': return 'An active authorized account and provider are required.';
    default: return 'This workflow does not meet the requirements for manual completion.';
  }
}
