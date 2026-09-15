export type ManualVerification = {
  integration: 'praktika' | 'mediref'; action: 'manually_verified_completed'; actorUserId: string;
  verifiedAt: string; priorJobId: string; attempt: number; draftId: string; intentId: string; verifiedSuccess: true;
};
export function manualVerification(response: unknown, integration: 'praktika' | 'mediref', draftId: string, intentId: string): ManualVerification | null {
  if (!response || typeof response !== 'object') return null;
  const entries = (response as { manualVerification?: Partial<Record<'praktika' | 'mediref', ManualVerification>> }).manualVerification;
  const value = entries?.[integration];
  return value?.action === 'manually_verified_completed' && value.integration === integration && value.verifiedSuccess === true
    && value.draftId === draftId && value.intentId === intentId && typeof value.actorUserId === 'string'
    && typeof value.priorJobId === 'string' && Number.isFinite(Date.parse(value.verifiedAt)) ? value : null;
}
