import {historicalEpoch,type HistoricalReconciliationEvent} from './historical-reconciliation';
import type {WorkflowDraft,WorkflowEvidence} from './resolved-workflow';
import {nonOperationalDraftIds} from './non-operational-drafts';
export const historicalAttentionAction='historical_attention_disposition';
export const historicalAttentionInvalidated='historical_attention_invalidated';
export type WorkflowAttention={type:'historical_non_actionable'|'non_operational_test';message:string;eventId?:string};
export const historicalAttentionMessage='Historical outcome incomplete/unknown — no further action required';
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function projectHistoricalAttention(d:WorkflowDraft,e:WorkflowEvidence,now=Date.now()):WorkflowAttention|undefined {
 if(d.id&&nonOperationalDraftIds.has(d.id))return {type:'non_operational_test',message:'Known non-operational record — retained for audit/testing history'};
 if(!d.id||!['approved','uploaded_to_praktika'].includes(d.status??'')||!d.updated_at||d.workflow_status==='running')return;
 const jobs=[...(e.parent?[e.parent]:[]),...e.uploads,...e.icons,...e.mediref];
 if(jobs.some(j=>['pending','waiting','running','processing'].includes(j.status)))return;
 const events=(e.reconciliations??[]).filter(a=>a.entity_id===d.id);
 const dispositions=events.filter(a=>a.action===historicalAttentionAction);
 if(dispositions.length!==1)return;
 const event=dispositions[0],v=obj(event.details),proof=obj(v.pdfEvidence);
 if(events.some(a=>a.action===historicalAttentionInvalidated&&obj(a.details).dispositionId===event.id))return;
 if(v.policyVersion!=='historical-attention-v1'||v.disposition!=='historical_non_actionable'||v.draftId!==d.id||v.epoch!==historicalEpoch(d)
   ||Date.parse(String(v.draftRevision))!==Date.parse(d.updated_at)||v.reason!=='historical_pdf_present_no_further_action'
   ||v.source!=='protected_historical_attention'||!/^([0-9a-f]{64})$/.test(String(v.reviewedFingerprint))
   ||!/^([0-9a-f]{64})$/.test(String(v.manifestDigest))||typeof v.authorizerUserId!=='string'
   ||JSON.stringify(v.branches)!==JSON.stringify(['mediref','icon','bookkeeping'])
   ||proof.presence!=='confirmed_present'||!['confirmed_upload','operator_attestation'].includes(String(proof.kind)))return;
 const stamp=Date.parse(String(v.recordedAt));
 if(!Number.isFinite(stamp)||stamp>now||Date.parse(d.created_at??'')>=Date.parse('2026-09-16T00:00:00Z'))return;
 if(jobs.some(j=>Math.max(Date.parse(j.created_at??'')||0,Date.parse(j.updated_at??'')||0)>stamp))return;
 return {type:'historical_non_actionable',eventId:event.id,message:historicalAttentionMessage};
}
