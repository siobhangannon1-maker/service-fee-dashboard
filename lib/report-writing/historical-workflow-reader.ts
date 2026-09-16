import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReadJob, WorkflowDraft } from './resolved-workflow';
import type { HistoricalEvidence, HistoricalUploadAudit } from './historical-workflow-evidence';
import { continuationIntentId } from './workflow-continuation-token';
interface EvidenceQuery extends PromiseLike<{ data: unknown[] | null; error: unknown }> {
  order(column: string): EvidenceQuery;
  range(from: number, to: number): EvidenceQuery;
  abortSignal(signal: AbortSignal): EvidenceQuery;
}

// A request owns this limiter and deadline. Queued work checks the same signal
// before issuing a request; pagination never refreshes the clock.
export function createWorkflowEvidenceReader(signal: AbortSignal) {
  let active = 0;
  const waiting: Array<() => void> = [];
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active < 8) active++; else await new Promise<void>(resolve => waiting.push(resolve));
    try { signal.throwIfAborted(); return await fn(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  }
  return { signal, async read<T>(values: string[], query: (ids: string[]) => EvidenceQuery, size = 100) {
    const ids = [...new Set(values)], rows: T[] = [], failed = new Set<string>();
    await Promise.all(Array.from({length: Math.ceil(ids.length / size)}, async (_,i) => {
      const batch = ids.slice(i*size,(i+1)*size), complete: T[] = [];
      try {
        for (let start=0; ; start+=500) {
          const data = await run(async () => {
            const {data,error} = await query(batch).order('id').range(start,start+499).abortSignal(signal);
            if (error || !Array.isArray(data)) throw new Error('Workflow evidence unavailable');
            return data;
          });
          complete.push(...data as T[]);
          if (data.length < 500) break;
        }
        signal.throwIfAborted();
        rows.push(...complete);
      } catch { for (const id of batch) failed.add(id); }
    }));
    return {rows,failed};
  }};
}
export type WorkflowEvidenceReader = ReturnType<typeof createWorkflowEvidenceReader>;
export const workflowJobColumns = 'id,job_type,status,app_user_id,request,response,created_at,updated_at,completed_at,failed_at,locked_at,locked_by';

// All evidence is scoped to this call. A failed query/page invalidates affected
// drafts; no partial page is used as completion evidence.
export async function readHistoricalWorkflowEvidence(db: SupabaseClient, drafts: WorkflowDraft[], reader: WorkflowEvidenceReader,
  parents: ReadonlyMap<string, ReadJob>): Promise<Map<string, HistoricalEvidence>> {
  const result = new Map<string, HistoricalEvidence>();
  const ids = drafts.map(d=>d.id!).filter(id=>/^[0-9a-f-]{36}$/.test(id));
  if (!ids.length) return result;
  const selectAudit = 'id,entity_type,entity_id,action,helperJobId:details->>helperJobId,storagePath:details->stagedPdf->>storagePath,bucket:details->stagedPdf->>bucket,fileName:details->stagedPdf->>fileName,contentType:details->stagedPdf->>contentType,patientId:details->>praktikaPatientId,actorUserId:details->>actorUserId';
  const appointments = [...new Set(drafts.map(d=>d.praktika_letter_icon_appointment_id).filter((id): id is string=>Boolean(id)))];
  const [auditRead, uploadRead, iconRead, iconAuditRead] = await Promise.all([
    reader.read<HistoricalUploadAudit>(ids,batch=>db.from('report_writing_audit_events').select(selectAudit)
      .eq('entity_type','report_draft').eq('action','Queued report upload to Praktika').in('entity_id',batch)),
    reader.read<ReadJob>(ids,batch=>db.from('praktika_helper_jobs').select(workflowJobColumns).eq('job_type','upload_report_to_praktika')
      .or(batch.map(id=>`request->body->file->>path.like.*/${id}/*`).join(',')),50),
    reader.read<ReadJob>(appointments,batch=>db.from('praktika_helper_jobs').select(workflowJobColumns)
      .eq('job_type','update_praktika_letter_icons').in('request->body->0->>appointment_id',batch)),
    reader.read<WorkflowDraft>(appointments,batch=>db.from('report_drafts')
      .select('id,praktika_letter_icon_appointment_id,praktika_letter_icon_updated_at').in('praktika_letter_icon_appointment_id',batch)),
  ]);
  const audits = auditRead.rows, uploads = uploadRead.rows;
  const missingIds = [...new Set(audits.map(a=>a.helperJobId).filter((id): id is string=>
    typeof id==='string' && /^[0-9a-f-]{36}$/.test(id) && !uploads.some(j=>j.id===id)))];
  const missing = await reader.read<ReadJob>(missingIds,batch=>db.from('praktika_helper_jobs').select(workflowJobColumns).in('id',batch));
  uploads.push(...missing.rows);
  // Zero/duplicate initial audits already fail the association contract. Only a
  // single audited job could qualify. Query OTHER events for those jobs, never
  // download the same audit event twice. Fifty helpers plus fifty excluded audit
  // IDs keep this two-ID-list URL conservatively bounded.
  const auditable = uploads.filter(j=>audits.filter(a=>a.helperJobId===j.id).length===1).map(j=>j.id);
  const linked = await reader.read<HistoricalUploadAudit>(auditable,batch=>{
    const known = audits.filter(a=>batch.includes(String(a.helperJobId))).map(a=>a.id);
    return db.from('report_writing_audit_events').select(selectAudit).eq('action','Queued report upload to Praktika')
      .in('details->>helperJobId',batch).not('id','in',`(${known.join(',')})`);
  },50);
  audits.push(...linked.rows);
  for (const d of drafts) {
    if (!d.id || !ids.includes(d.id)) continue;
    const draftAudits = audits.filter(a=>a.entity_id===d.id);
    const draftUploads = uploads.filter(j=>{
      const path = (j.request?.body as {file?: {path?: unknown}} | undefined)?.file?.path;
      return draftAudits.some(a=>a.helperJobId===j.id) || typeof path==='string' && path.includes(`/${d.id}/`);
    });
    const appointment = d.praktika_letter_icon_appointment_id || '';
    if (auditRead.failed.has(d.id) || uploadRead.failed.has(d.id) || iconRead.failed.has(appointment) || iconAuditRead.failed.has(appointment) ||
      draftAudits.some(a=>missing.failed.has(String(a.helperJobId))) || draftUploads.some(j=>linked.failed.has(j.id))) continue;
    result.set(d.id, {
      audits: audits.filter(a=>a.entity_id===d.id || draftUploads.some(j=>j.id===a.helperJobId)), uploads: draftUploads,
      icons: iconRead.rows.filter(j=>{ const body=j.request?.body; return Array.isArray(body) && String(body[0]?.appointment_id ?? '')===appointment; }),
      hasParent: parents.has(continuationIntentId(d.id)),
      duplicateIconAudit: iconAuditRead.rows.some(other=>other.id!==d.id && other.praktika_letter_icon_appointment_id===appointment &&
        Boolean(d.praktika_letter_icon_updated_at) && Date.parse(other.praktika_letter_icon_updated_at || '')===Date.parse(d.praktika_letter_icon_updated_at!)),
    });
  }
  return result;
}
