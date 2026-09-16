import type { ResolvedWorkflow, WorkflowDraft, WorkflowEvidence } from './resolved-workflow';

export const historicalReconciliationAction = 'system_historical_reconciliation';
export const historicalInvalidationAction = 'system_historical_reconciliation_invalidated';
export const historicalRetentionReleaseAction = 'system_historical_retention_released';
export type HistoricalReconciliationEvent = { id: string; action: string; entity_id: string; details: unknown };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function stamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const fraction = value.match(/\.(\d+)/)?.[1] || '';
  return new Date(value).toISOString().slice(0,19) + '.' + fraction.padEnd(6,'0').slice(0,6) + 'Z';
}
export function historicalEpoch(d: WorkflowDraft): string | null {
  const created=stamp(d.created_at), approved=stamp(d.provider_approved_at);
  return created && (!d.provider_approved_at || approved) ? `${created}/${approved || 'unrecorded'}` : null;
}

// Events come only from the privileged, indexed server lookup. Never accept a
// browser-provided completion marker. Modern activity always takes precedence.
export function durableHistoricalWorkflow(d: WorkflowDraft, e: WorkflowEvidence, now: number): ResolvedWorkflow | null {
  if (e.parent || e.hasOtherParent || e.uploads.length || e.icons.length) return null;
  const epoch=historicalEpoch(d);
  if (!epoch || !['approved','uploaded_to_praktika'].includes(d.status || '')) return null;
  const events=(e.reconciliations || []).filter(event=>event.entity_id===d.id && object(event.details).epoch===epoch);
  const completions=events.filter(event=>event.action===historicalReconciliationAction);
  if (completions.length!==1 || events.some(event=>event.action===historicalInvalidationAction)) return null;
  const details=object(completions[0].details), outcomes=object(details.branches);
  if (details.source!=='controlled_historical_cleanup' || details.contract!=='historical-v1' || details.reconciliationVersion!==1
    || details.draftId!==d.id || details.eventId!==completions[0].id || !stamp(details.reconciledAt)) return null;
  const praktika=object(outcomes.praktika), mediref=object(outcomes.mediref), icon=object(outcomes.icon), periodontal=object(outcomes.periodontal);
  const terminal=(v: Record<string,unknown>)=>v.outcome==='completed'||v.outcome==='skipped';
  if (praktika.outcome!=='completed' || praktika.basis!=='system_verified_historical_completion'
    || typeof praktika.jobId!=='string' || typeof praktika.auditId!=='string'
    || ![mediref,icon,periodontal].every(terminal)
    || [mediref,icon,periodontal].some(v=>v.outcome==='completed'&&typeof v.jobId!=='string')) return null;
  // A later direct MediRef attempt cannot be hidden by an older reconciliation.
  if (e.mediref.some(j=>j.id!==mediref.jobId || j.status!=='completed' || j.payload?.workflowContinuationId || j.payload?.retryMediref)) return null;
  const historicalTime=typeof details.historicalCompletedAt==='string'?Date.parse(details.historicalCompletedAt):NaN;
  const completedAt=Number.isFinite(historicalTime)&&historicalTime>0&&historicalTime<=now?historicalTime:null;
  const releases=events.filter(event=>event.action===historicalRetentionReleaseAction);
  const release=object(releases[0]?.details);
  const released=releases.length===1 && release.source==='controlled_historical_cleanup' && release.contract==='historical-v1'
    && release.reconciliationId===completions[0].id && release.reason==='verified_historical_cleanup'
    && typeof release.reviewReference==='string' && /^[a-zA-Z0-9._-]{1,80}$/.test(release.reviewReference)
    && typeof release.releasedAt==='string' && Number.isFinite(Date.parse(release.releasedAt))
    && Date.parse(release.releasedAt)>=Date.parse(String(details.reconciledAt)) && Date.parse(release.releasedAt)<=now;
  return {status:'completed',message:null,branches:{praktika:'completed',mediref:mediref.outcome as 'completed'|'skipped',
    icon:icon.outcome as 'completed'|'skipped',periodontal:periodontal.outcome as 'completed'|'skipped'},
    lastProgressAt:completedAt,completedAt,historicalRetention:{reconciliationId:completions[0].id,released},
    lookupUnavailable:false,praktikaRecovery:false,medirefRecovery:false};
}
