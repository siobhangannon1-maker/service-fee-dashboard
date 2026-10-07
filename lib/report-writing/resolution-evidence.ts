import type {ResolvedWorkflow,WorkflowDraft,WorkflowEvidence} from './resolved-workflow';
export type ResolutionProjection={draftId:string;letterFingerprint:string;events:{id:string;action:string;details:Record<string,unknown>}[];executionSafe:boolean};
export function applyResolutionEvidence(d:WorkflowDraft,e:WorkflowEvidence,automated:ResolvedWorkflow):ResolvedWorkflow {
  const resolution=e.resolution;
  if(!resolution || resolution.draftId!==d.id)return automated;
  const events=resolution.events.filter(x=>x.details.contract==='workflow-resolution-v1' && x.details.version===1 && x.details.draftId===d.id && x.details.letterFingerprint===resolution.letterFingerprint);
  const evidence:NonNullable<ResolvedWorkflow['branchEvidence']>={};
  const result={...automated,branches:{...automated.branches},branchEvidence:evidence};
  for(const branch of ['praktika','icon','mediref','periodontal'] as const) {
    const verification=events.filter(x=>x.action==='workflow_resolution_verification' && x.details.branch===branch).at(-1);
    evidence[branch]={automated:automated.branches[branch],...(verification?{manual:verification.details.outcome as 'completed'|'incomplete',actorUserId:String(verification.details.actorUserId),verifiedAt:String(verification.details.verifiedAt)}:{})};
    if(!resolution.executionSafe) { evidence[branch].executionUncertain=true; continue; }
    if(!['completed','skipped'].includes(automated.branches[branch]) && verification?.details.outcome==='completed') result.branches[branch]='completed';
  }
  if(!resolution.executionSafe && automated.status==='completing')return result;
  if(!resolution.executionSafe) return {...result,status:'needs_attention',message:'Workflow execution is active or uncertain. Verification is blocked.',completedAt:null,praktikaRecovery:false,medirefRecovery:false};
  const closure=events.find(x=>x.action==='workflow_resolution_completed');
  if(closure)return {...result,status:'completed',message:null,completedAt:null,praktikaRecovery:false,medirefRecovery:false,operatorCompletion:{eventId:closure.id,actorUserId:String(closure.details.actorUserId),completedAt:String(closure.details.completedAt),source:String(closure.details.source),attestedBranches:Object.entries((closure.details.outcomes || {}) as Record<string,unknown>).filter(([,v])=>v==='completed').map(([k])=>k)}};
  return result;
}
