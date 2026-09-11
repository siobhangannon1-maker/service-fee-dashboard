// Only fixed reviewed messages may reach the start alert. Never display arbitrary
// server text or transport exceptions (which can contain URLs/database details).
export const workflowStartUnconfirmed = 'Workflow start could not be confirmed. Please refresh and try Complete Workflow again; any existing workflow will be reconciled.';
const safeMessages = new Set([
  'An active login is required.',
  'Praktika connection required. Please connect to Praktika and try again.',
  'Invalid workflow start.', 'Invalid workflow options.', 'Missing draftId.',
  'Workflow continuation is not configured.',
  'Workflow prerequisites could not be checked. No reservation was attempted. Please refresh and try again; contact an administrator if this persists.',
  'Workflow intent lookup is temporarily unavailable. No reservation was attempted. Please try again.',
  'This workflow already exists or needs reconciliation. The approved letter is retained.',
]);
export class WorkflowStartError extends Error {
  constructor(payload: unknown) {
    const message = payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : undefined;
    super(typeof message === 'string' && safeMessages.has(message) ? message : workflowStartUnconfirmed);
  }
}
export function workflowStartAlert(error: unknown): string {
  return error instanceof WorkflowStartError ? error.message : workflowStartUnconfirmed;
}
