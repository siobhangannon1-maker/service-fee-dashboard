import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveWorkflow, shouldAppearInApproved, type WorkflowDraft, type WorkflowEvidence, type ReadJob } from './resolved-workflow';
import { historicalWorkflowAssociation } from './historical-workflow-evidence';
import { retentionPlan, retentionSettings } from './retention';
import { projectHistoricalWorkflowRecovery as projectWorkflowRecovery } from './historical-workflow-offline';
import type { SupabaseClient } from '@supabase/supabase-js';

const id='11111111-1111-1111-1111-111111111111', actor='22222222-2222-2222-2222-222222222222';
const now=Date.parse('2026-09-15T12:00:00Z'), stamp='2026-08-01T12:00:00Z';
function fixture() {
  const d: WorkflowDraft & {id:string}={id,status:'approved',workflow_status:'completed',workflow_praktika_upload_status:'completed',
    workflow_icon_update_status:'completed',workflow_mediref_status:'completed',workflow_periodontal_chart_status:'skipped',
    praktika_patient_id:'123',praktika_letter_icon_appointment_id:'456',praktika_letter_icon_updated_at:stamp,
    praktika_letter_icon_update_response_preview:'{"saved":true}'};
  const file={path:`report-uploads/${actor}/${id}/123-letter.pdf`,fileName:'letter.pdf',bucket:'private',contentType:'application/pdf',fieldName:'patient_communication[file][file]'};
  const upload: ReadJob={id:'upload',job_type:'upload_report_to_praktika',status:'completed',app_user_id:actor,updated_at:stamp,
    request:{method:'POST',path:'/php/forms/db_updateFormData.php',contentType:'multipart_storage',body:{file,fields:{patient_id:'123','patient_communication[file][name]':'letter.pdf'}}},response:{patient_communication:{iFileId:42}}};
  const icon: ReadJob={id:'icon',job_type:'update_praktika_letter_icons',status:'completed',app_user_id:actor,created_at:stamp,updated_at:stamp,request:{body:[{appointment_id:'456'}]},response:{saved:true}};
  const audit={id:'audit',entity_type:'report_draft',entity_id:id,action:'Queued report upload to Praktika',helperJobId:upload.id,storagePath:file.path,bucket:file.bucket,fileName:file.fileName,contentType:file.contentType,patientId:'123',actorUserId:actor};
  const med: ReadJob={id:'med',job_type:'send_mediref_letter',status:'completed',updated_at:stamp,payload:{draftId:id},result:{prepared:true,remoteDraftSaved:true,sent:false,recipientMatchingSkipped:true}};
  const h={uploads:[upload],icons:[icon],audits:[audit],hasParent:false};
  const e: WorkflowEvidence={uploads:[],icons:[],mediref:[med],livePraktikaActors:new Set(),liveMediref:false,historical:h};
  return {d,e,h,upload,icon,audit,file,med};
}
const resolved=(f:ReturnType<typeof fixture>)=>resolveWorkflow(f.d,f.e,now);
test('historical path plus independent audit resolves without rewriting jobs or fabricating modern links',()=>{
  const f=fixture(), before=JSON.stringify(f);const a=historicalWorkflowAssociation(f.d,f.e);
  assert.equal(a?.upload,f.upload);assert.equal(a?.icon,f.icon);
  assert.equal(resolved(f).status,'completed');assert.equal(shouldAppearInApproved({...f.d,workflow_resolved:resolved(f)}),false);
  assert.equal(JSON.stringify(f),before);assert.equal(f.upload.request!.reportDraftId,undefined);
  assert.ok(retentionPlan({...f.d,id,updated_at:stamp,source_text:'synthetic',workflow_resolved:resolved(f)},retentionSettings({})!,now));
});
const defects: Record<string,(f:ReturnType<typeof fixture>)=>void>={
  wrong_type:f=>{f.upload.job_type='other';}, not_completed:f=>{f.upload.status='failed';}, no_confirmation:f=>{f.upload.response={success:true};},
  wrong_draft:f=>{f.d.id=actor;}, wrong_audit_draft:f=>{f.audit.entity_id=actor;}, wrong_audit_job:f=>{f.audit.helperJobId='other';},
  wrong_audit_path:f=>{f.audit.storagePath+='other';}, wrong_audit_patient:f=>{f.audit.patientId='other';}, wrong_patient:f=>{f.d.praktika_patient_id='other';},
  wrong_scope:f=>{f.upload.app_user_id=id;}, wrong_audit_actor:f=>{f.audit.actorUserId=id;}, missing_audit:f=>{f.h.audits=[];},
  duplicate_audit:f=>{f.h.audits.push({...f.audit,id:'second'});}, malformed_path:f=>{f.file.path='report-uploads/../letter.pdf';},
  wrong_filename:f=>{f.file.fileName='other.pdf';}, wrong_bucket:f=>{f.audit.bucket='other';}, wrong_content_type:f=>{f.file.contentType='text/plain';},
  multiple_success:f=>{f.h.uploads.push({...f.upload,id:'second'});}, later_failed:f=>{f.h.uploads.push({...f.upload,id:'second',status:'failed'});},
  current_pending:f=>{f.h.uploads.push({...f.upload,id:'second',status:'pending'});}, modern_parent:f=>{f.e.parent={...f.upload,job_type:'complete_report_workflow'};},
  malformed_parent:f=>{f.h.hasParent=true;}, other_parent:f=>{f.e.hasOtherParent=true;}, modern_direct:f=>{f.upload.request!.reportDraftId=id;},
  modern_continuation:f=>{f.upload.request!.continuationId='parent';}, retry:f=>{f.upload.request!.manualRetry={priorJobId:'old'};},
  replacement:f=>{f.upload.response={...f.upload.response as object,retryUploadId:'replacement'};}, revision:f=>{f.upload.request!.reportRevision='different';},
  missing_med:f=>{f.e.mediref=[];}, failed_med:f=>{f.med.status='failed';}, newer_failed_med:f=>{f.e.mediref.push({...f.med,id:'new',status:'failed'});},
  med_send_false_only:f=>{f.med.result={sent:false};}, med_retry:f=>{f.med.payload!.retryMediref={};},
  icon_ambiguous:f=>{f.h.icons.push({...f.icon,id:'second'});}, icon_failed:f=>{f.icon.status='failed';}, icon_missing:f=>{f.h.icons=[];},
  icon_wrong_response:f=>{f.icon.response={saved:false};}, icon_wrong_appointment:f=>{f.icon.request!.body=[{appointment_id:'other'}];},
  icon_timing_only:f=>{f.d.praktika_letter_icon_update_response_preview=null;}, icon_wrong_actor:f=>{f.icon.app_user_id=id;},
  chart_error:f=>{f.d.periodontal_chart_attachment_error='unresolved';}, missing_workflow:f=>{f.d.workflow_status=null;},
  enrichment_missing:f=>{delete f.e.historical;},
  duplicate_icon_audit:f=>{Object.assign(f.h,{duplicateIconAudit:true});},
  newer_approval:f=>{f.d.provider_approved_at='2026-09-01T12:00:00Z';f.upload.created_at=stamp;},
};
for(const [name,change] of Object.entries(defects))test(`historical guard ${name} keeps Approved and denies retention`,()=>{
  const f=fixture();change(f);const r=resolved(f);
  assert.notEqual(r.status,'completed');assert.equal(shouldAppearInApproved({...f.d,workflow_resolved:r}),true);
  assert.equal(retentionPlan({...f.d,id,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
test('historical adapter preserves narrow skipped-chart compatibility',()=>{
  const f=fixture();f.d.periodontal_chart_attachment_error='Periodontal chart was requested, but no periodontal chart was found.';
  assert.equal(resolved(f).status,'completed');assert.equal(resolved(f).branches.periodontal,'skipped');
  f.d.periodontal_chart_attachment_name='unexpected.pdf';assert.notEqual(resolved(f).status,'completed');
});
test('historical attachment completion requires exact existing MediRef attachment',()=>{
  const f=fixture();f.d.workflow_periodontal_chart_status='pending';f.d.periodontal_chart_attachment_name='chart.pdf';f.d.periodontal_chart_attached_at=stamp;
  f.med.payload!.attachments=[{fileName:'chart.pdf'}];assert.equal(resolved(f).status,'completed');
  f.med.payload!.attachments=[];assert.notEqual(resolved(f).status,'completed');
});
test('historical modules are read-only and contain no patient-name application exclusion',()=>{
  const source=['historical-workflow-reader.ts','historical-workflow-evidence.ts'].map(f=>readFileSync(`lib/report-writing/${f}`,'utf8')).join('\n');
  assert.doesNotMatch(source,/\.(insert|update|upsert|delete|rpc)\s*\(|fetch\s*\(|createPraktika|createMediref|test test|testing testing|siobhan gannon/i);
});

for (const mode of ['normal','audit_error','audit_later_page_error','icon_error','cross_draft_audit','cross_draft_icon_audit','hidden_failed_upload']) test(`historical read pipeline ${mode}`,async()=>{
  const f=fixture();
  const tables:Record<string,unknown[]>={praktika_helper_jobs:[f.upload,f.icon],mediref_helper_jobs:[f.med],report_writing_audit_events:[f.audit],report_drafts:[f.d]};
  if(mode==='cross_draft_audit')tables.report_writing_audit_events.push({...f.audit,id:'different',entity_id:actor});
  if(mode==='cross_draft_icon_audit')tables.report_drafts.push({...f.d,id:actor});
  if(mode==='hidden_failed_upload')tables.praktika_helper_jobs.push({...f.upload,id:'failed',status:'failed'});
  const calls:string[]=[];
  const db={from(table:string){
    calls.push(table);let rows=[...(tables[table]||[])],start=0,end=499;
    const value=(row:unknown,key:string):unknown=>(key==='details->>helperJobId' ? ['helperJobId'] : key.split(/->>?/)).reduce<unknown>((v,k)=>v && typeof v==='object' ? (v as Record<string,unknown>)[k] : undefined,row);
    const q={select(){return q;},order(){return q;},range(a:number,b:number){start=a;end=b;return q;},abortSignal(){return q;},
      eq(key:string,v:unknown){rows=rows.filter(r=>value(r,key)===v);return q;},
      in(key:string,v:unknown[]){rows=rows.filter(r=>v.includes(value(r,key)));return q;},
      not(key:string,_op:string,v:string){rows=rows.filter(r=>!v.slice(1,-1).split(',').includes(String(value(r,key))));return q;},
      or(){rows=rows.filter(r=>String(value(r,'request->body->file->>path')).includes(`/${id}/`));return q;},
      then(onfulfilled:(v:unknown)=>unknown,onrejected:(e:unknown)=>unknown){
        const fail=mode==='icon_error'&&table==='praktika_helper_jobs'&&rows.some(r=>(r as {job_type?:string}).job_type==='update_praktika_letter_icons') || table==='report_writing_audit_events'&&(mode==='audit_error'||mode==='audit_later_page_error'&&start>=500);
        const data=table==='report_writing_audit_events'&&mode==='audit_later_page_error'&&start===0 ? Array.from({length:500},(_,i)=>({...f.audit,id:`audit-${i}`})) : rows.slice(start,end+1);
        return Promise.resolve({data:fail?null:data,error:fail?{message:'PRIVATE_ERROR'}:null}).then(onfulfilled,onrejected);
      }};return q;
  }};
  const before=JSON.stringify(tables);
  const [out]=await projectWorkflowRecovery(db as unknown as SupabaseClient,[f.d]);
  if(mode==='normal')assert.equal(out.workflow_resolved?.status,'completed');
  else {assert.notEqual(out.workflow_resolved?.status,'completed');assert.equal(retentionPlan({...out,id,updated_at:stamp},retentionSettings({})!,now),null);}
  if(mode.includes('error'))assert.equal(out.workflow_resolved?.lookupUnavailable,true);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE_ERROR/);assert.equal(JSON.stringify(tables),before);
  assert.ok(calls.includes('report_writing_audit_events'));
});
