type VerificationBase = {
  integration: 'praktika' | 'mediref'; action: 'manually_verified_completed'; actorUserId: string;
  verifiedAt: string; draftId: string; intentId: string; verifiedSuccess: true;
};
export type ManualVerification = VerificationBase & ({
  priorJobId: string; attempt: number; source?: undefined; recoveryClass?: undefined;
} | {
  integration: 'mediref'; priorJobId: null; attempt: 0; source: 'manually_sent';
  recoveryClass: 'no_prior_helper_job_v1'; reason: 'operator_confirmed_exact_approved_letter_sent';
  letterFingerprint: string; previewFingerprint: string; originalFailure: Record<string, unknown>;
});
export function manualVerification(response: unknown, integration: 'praktika' | 'mediref', draftId: string, intentId: string): ManualVerification | null {
  if (!response || typeof response !== 'object') return null;
  const entries = (response as { manualVerification?: Partial<Record<'praktika' | 'mediref', ManualVerification>> }).manualVerification;
  const value = entries?.[integration];
  if (!value || value.action !== 'manually_verified_completed' || value.integration !== integration || value.verifiedSuccess !== true
    || value.draftId !== draftId || value.intentId !== intentId || typeof value.actorUserId !== 'string'
    || !Number.isFinite(Date.parse(value.verifiedAt))) return null;
  if (typeof value.priorJobId === 'string' && value.source === undefined) return value;
  return integration === 'mediref' && value.source === 'manually_sent' && value.recoveryClass === 'no_prior_helper_job_v1'
    && value.priorJobId === null && value.attempt === 0 && value.reason === 'operator_confirmed_exact_approved_letter_sent'
    && /^[0-9a-f]{64}$/.test(value.letterFingerprint) && /^[0-9a-f]{64}$/.test(value.previewFingerprint)
    && Boolean(value.originalFailure && typeof value.originalFailure === 'object') ? value : null;
}
