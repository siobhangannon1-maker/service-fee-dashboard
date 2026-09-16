// Offline/admin-only contract. No name exclusion belongs in the runtime resolver.
import { createHash } from 'node:crypto';
export const historicalCleanupExcluded = (name: unknown) => typeof name==='string' &&
  ['test test','testing testing','siobhan gannon'].includes(name.trim().toLowerCase());
export type HistoricalProposal = {ok:true;draftId:string;epoch:string;eventId:string;fingerprint:string;contract:'historical-v1';
  branches:Record<string,unknown>;historicalCompletedAt:string|null;
  reconciliationState?:'none'|'active'|'invalidated';reconciledFingerprint?:string|null};
export type HistoricalManifest = {version:1;projectRef:string;generatedAt:string;executionVersion:string;proposals:HistoricalProposal[];reviewResults?:unknown[]};
export function manifestDigest(text:string) {return createHash('sha256').update(text).digest('hex');}
export function validHistoricalProposal(value:unknown): value is HistoricalProposal {
  if (!value || typeof value!=='object') return false;
  const p=value as Partial<HistoricalProposal>;
  return p.ok===true && p.contract==='historical-v1' && typeof p.draftId==='string' && /^[a-f0-9-]{36}$/.test(p.draftId)
    && typeof p.eventId==='string' && /^[a-f0-9-]{36}$/.test(p.eventId) && typeof p.epoch==='string'
    && typeof p.fingerprint==='string' && /^[a-f0-9]{64}$/.test(p.fingerprint) && !!p.branches && typeof p.branches==='object';
}
export function retentionImpact(completedAt:string|null, presence:{source:boolean;ai:boolean;final:boolean},
 markers:{source:string|null;ai:string|null;final:string|null}, policy:{sourceDays:number;aiDays:number;finalDays:number;deleteFinalText:boolean},now=Date.now()) {
  const time=completedAt?Date.parse(completedAt):NaN;
  const ageDays=Number.isFinite(time)&&time>0&&time<=now?(now-time)/86400000:null;
  return {historicalCompletedAt:completedAt,ageDays,markers,policy,
    sourceEligible:ageDays!==null&&presence.source&&!markers.source&&ageDays>=policy.sourceDays,
    aiEligible:ageDays!==null&&presence.ai&&!markers.ai&&ageDays>=policy.aiDays,
    finalEligible:ageDays!==null&&presence.final&&!markers.final&&policy.deleteFinalText&&ageDays>=policy.finalDays};
}
