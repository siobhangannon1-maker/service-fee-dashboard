import { shouldAppearInApproved, type WorkflowDraft } from './resolved-workflow';
export const praktikaVerificationMessage = 'Praktika upload needs verification.';
export function remainsInApproved(draft: WorkflowDraft) {
  return shouldAppearInApproved(draft);
}
