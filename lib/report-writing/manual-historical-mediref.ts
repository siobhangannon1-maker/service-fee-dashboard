import {historicalEpoch, historicalReconciliationAction} from './historical-reconciliation';
import type {ResolvedWorkflow, WorkflowDraft, WorkflowEvidence} from './resolved-workflow';

export const manualHistoricalMedirefAction = 'manual_historical_mediref_verification';
export const manualHistoricalMedirefInvalidation = 'manual_historical_mediref_invalidated';
export const manualHistoricalMedirefRelease = 'manual_historical_mediref_retention_released';
export const manualHistoricalMedirefActions = [manualHistoricalMedirefAction, manualHistoricalMedirefInvalidation, manualHistoricalMedirefRelease];
export const manualHistoricalMedirefContract = 'manual-historical-mediref-v1';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown, now: number) => typeof v === 'string' && Date.parse(v)>0 && Date.parse(v)<=now;
export type HistoricalMedirefProvenance = {eventId: string; source: 'human_external_verification'; verifierUserId: string;
  verifiedAt: string; importedAt: string; failedJobIds: string[]};

// Only the privileged bounded audit lookup supplies these events. The SQL RPC
// establishes other-branch evidence; transactional source fences invalidate it.
// No old failed job/result is rewritten or represented as a successful helper.
export function manualHistoricalMedirefWorkflow(d: WorkflowDraft, e: WorkflowEvidence, now: number): ResolvedWorkflow | null {
  if (!d.id || !['approved','uploaded_to_praktika'].includes(d.status || '') || e.parent || e.hasOtherParent || e.uploads.length || e.icons.length) return null;
  const epoch=historicalEpoch(d);
  if (!epoch) return null;
  const events=(e.reconciliations || []).filter(x=>x.entity_id===d.id && object(x.details).epoch===epoch);
  const matches=events.filter(x=>x.action===manualHistoricalMedirefAction);
  if (matches.length!==1 || events.some(x=>x.action===manualHistoricalMedirefInvalidation || x.action===historicalReconciliationAction)) return null;
  const event=matches[0],v=object(event.details),other=object(v.otherBranches);
  if (v.contract!==manualHistoricalMedirefContract || v.version!==1 || v.source!=='human_external_verification'
    || v.integration!=='mediref' || v.outcome!=='completed' || v.draftId!==d.id || v.eventId!==event.id
    || !uuid(v.verifierUserId) || !date(v.verifiedAt,now) || !date(v.importedAt,now)
    || Date.parse(String(v.verifiedAt))>Date.parse(String(v.importedAt))
    || ![v.fingerprint,v.pdfFingerprint,v.workbookFingerprint,v.manifestFingerprint].every(hex)
    || !Array.isArray(v.failedJobIds) || v.failedJobIds.length<1 || v.failedJobIds.length>2
    || !v.failedJobIds.every(uuid) || new Set(v.failedJobIds).size!==v.failedJobIds.length
    || Object.keys(other).length!==3 || !['praktika','icon','periodontal'].every(k=>['completed','skipped','unknown'].includes(String(other[k])))
    || other.praktika==='skipped' || other.periodontal==='completed'
    || v.historicalCompletedAt!==null) return null;
  const ids=v.failedJobIds as string[];
  if (e.mediref.length!==ids.length || e.mediref.some(j=>!ids.includes(j.id) || j.status!=='failed'
    || j.payload?.draftId!==d.id || Object.hasOwn(j.payload || {},'workflowContinuationId') || Object.hasOwn(j.payload || {},'retryMediref'))) return null;
  const branches: ResolvedWorkflow['branches']={praktika:other.praktika as 'completed'|'unknown',icon:other.icon as 'completed'|'skipped'|'unknown',
    periodontal:other.periodontal as 'skipped'|'unknown',mediref:'completed'};
  const done=Object.values(branches).every(x=>x==='completed'||x==='skipped');
  const releases=events.filter(x=>x.action===manualHistoricalMedirefRelease),release=object(releases[0]?.details);
  const released=releases.length===1 && release.contract===manualHistoricalMedirefContract && release.source==='human_external_verification'
    && release.verificationId===event.id && typeof release.reviewReference==='string' && /^[a-zA-Z0-9._-]{1,80}$/.test(release.reviewReference)
    && date(release.releasedAt,now) && Date.parse(String(release.releasedAt))>=Date.parse(String(v.importedAt));
  return {status:done?'completed':'needs_attention',message:done?null:branches.praktika==='unknown'?'Praktika upload needs verification.':'Remaining workflow evidence needs verification.',
    branches,completedAt:null,lastProgressAt:null,lookupUnavailable:false,praktikaRecovery:false,medirefRecovery:false,
    historicalRetention:{reconciliationId:event.id,released},
    historicalMedirefVerification:{eventId:event.id,source:'human_external_verification',verifierUserId:v.verifierUserId,
      verifiedAt:String(v.verifiedAt),importedAt:String(v.importedAt),failedJobIds:[...ids]}};
}
