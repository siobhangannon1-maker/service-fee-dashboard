// Controlled offline tooling only. Do not import into list routes or workers.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWorkflowEvidenceReader, readHistoricalWorkflowEvidence, workflowJobColumns } from './historical-workflow-reader';
import { resolveWorkflow, unavailableWorkflow, type WorkflowDraft, type WorkflowEvidence } from './resolved-workflow';
import { continuationIntentId } from './workflow-continuation-token';
export async function projectHistoricalWorkflowRecovery<T extends WorkflowDraft & {id:string}>(db: SupabaseClient,drafts:T[]) {
  const reader=createWorkflowEvidenceReader(AbortSignal.timeout(5000));
  const ids=drafts.map(d=>d.id);
  const [parents,direct,med]=await Promise.all([
    reader.read<NonNullable<WorkflowEvidence['parent']>>(ids,b=>db.from('praktika_helper_jobs').select(workflowJobColumns)
      .eq('job_type','complete_report_workflow').or(`id.in.(${b.map(continuationIntentId).join(',')}),request->>reportDraftId.in.(${b.join(',')})`),50),
    reader.read<WorkflowEvidence['uploads'][number]>(ids,b=>db.from('praktika_helper_jobs').select(workflowJobColumns)
      .in('job_type',['upload_report_to_praktika','update_praktika_letter_icons']).in('request->>reportDraftId',b)),
    reader.read<WorkflowEvidence['mediref'][number]>(ids,b=>db.from('mediref_helper_jobs').select('id,job_type,status,payload,result,created_at,updated_at,locked_at,locked_by')
      .eq('job_type','send_mediref_letter').in('payload->>draftId',b)),
  ]);
  const parentMap=new Map(parents.rows.map(p=>[p.id,p]));
  const history=await readHistoricalWorkflowEvidence(db,drafts,reader,parentMap);
  return drafts.map(d=>{
    if (parents.failed.has(d.id)||direct.failed.has(d.id)||med.failed.has(d.id)||!history.has(d.id))
      return {...d,workflow_resolved:unavailableWorkflow()};
    const jobs=direct.rows.filter(j=>j.request?.reportDraftId===d.id);
    return {...d,workflow_resolved:resolveWorkflow(d,{parent:parentMap.get(continuationIntentId(d.id)),
      hasOtherParent:parents.rows.some(p=>p.request?.reportDraftId===d.id),uploads:jobs.filter(j=>j.job_type==='upload_report_to_praktika'),
      icons:jobs.filter(j=>j.job_type==='update_praktika_letter_icons'),mediref:med.rows.filter(j=>j.payload?.draftId===d.id),
      historical:history.get(d.id),livePraktikaActors:new Set(),liveMediref:false})};
  });
}
