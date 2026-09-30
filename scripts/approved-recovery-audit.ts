/** One-off read-only provider audit. Never imports/invokes an action POST. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { projectWorkflowRecovery } from '../lib/report-writing/workflow-recovery';
import { approvedWorkflow, shouldAppearInApproved, staleWorkflowMessage, type WorkflowDraft } from '../lib/report-writing/resolved-workflow';
import * as token from '../lib/report-writing/workflow-continuation-token';
import { toDraftListItem } from '../lib/report-writing/draft-contract';
import { requiresWorkflowVerification } from '../lib/report-writing/typist-approved-partition';
import { typistApprovedPresentation } from '../lib/report-writing/typist-mediref-presentation';
import { isConfirmedPraktikaUpload } from '../lib/report-writing/praktika-upload-result';

export const providerId = '838e86ae-6833-47e9-9669-9d4428992733';
const project = 'laolaeigxhgkotchrefj';
type Row = Record<string, any>; // Local captured API rows; never used by application code.
export type Eligibility = { eligible?: boolean; reason?: string; unavailable?: boolean };
export function actionBucket(draft: WorkflowDraft, checks: Record<string, Eligibility>, hasParent: boolean) {
  const r = approvedWorkflow(draft);
  if (r.lookupUnavailable || Object.values(checks).some(e=>e.unavailable)) return 'unresolved_no_safe_action';
  if (checks.retry.eligible) return 'retry_praktika_available';
  if (checks.mediref.eligible) return 'resume_mediref_available';
  if (checks.workflow.eligible) return 'resume_workflow_available';
  if (r.praktikaRecovery || r.medirefRecovery) return 'manual_verification_required';
  if (r.status==='completing') return 'genuinely_active_workflow';
  if (r.status==='not_started') return 'legacy_no_workflow';
  if (!hasParent && ['unknown','failed'].includes(r.branches.mediref)) return 'historical_delivery_unconfirmed';
  return 'unresolved_no_safe_action';
}

// Actual route code is evaluated with a memory-only database and fail-fast action
// dependencies. Auth is an explicit assumed active Typist for advisory comparison,
// not authentication of an operator and never permission to perform an action.
export function offlineGet(route: string, tables: Record<string,Row[]>, secret: string) {
  const db = { from(table:string) {
    if (!(table in tables)) throw new Error('uncaptured_table');
    let rows=[...tables[table]],single=false;
    const value=(r:Row,k:string)=>k.split(/->>?/).reduce((v,key)=>v?.[key],r);
    const q={ select:()=>q,eq:(k:string,v:unknown)=>{rows=rows.filter(r=>value(r,k)===v);return q;},
      in:(k:string,v:unknown[])=>{rows=rows.filter(r=>v.includes(value(r,k)));return q;},
      abortSignal:()=>q,maybeSingle:()=>{single=true;return q;},
      then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:single?rows[0]||null:rows,error:single&&rows.length>1?{}:null}).then(resolve)};
    return q;
  },rpc:()=>{throw new Error('rpc_forbidden');}};
  const fail=()=>{throw new Error('action_forbidden');};
  const exports:Record<string,any>={};
  const modules:Record<string,unknown>={
    'next/server':{NextResponse:{json:(data:unknown,opts?:ResponseInit)=>Response.json(data,opts)}},
    '@/lib/auth':{ApiAuthorizationError:class extends Error{},requireActiveApiUser:async()=>({user:{id:'offline-assumed-active-typist'}})},
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/report-writing/workflow-continuation-token':token,
    '@/lib/report-writing/praktika-upload-result':{isConfirmedPraktikaUpload},
    '@/lib/report-writing/workflow-execution-context':{withWorkflowExecution:fail},
    '../send-via-mediref/route':{POST:fail},
  };
  const js=ts.transpileModule(readFileSync(`app/api/report-writing/${route}/route.ts`,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,require:(id:string)=>{if(!(id in modules))throw new Error('unapproved_import');return modules[id];},
    Request,Response,URL,AbortSignal,process:{env:{SUPABASE_SERVICE_ROLE_KEY:secret}}});
  return async(draftId:string):Promise<Eligibility>=>{
    const response:Response=await exports.GET(new Request(`https://audit.invalid/?draftId=${draftId}`));
    const data=await response.json();return {eligible:data.eligible===true,reason:data.reason || 'unspecified',unavailable:response.status>=500};
  };
}

type Provider = {id:string;name:string;is_active:boolean};
type Environment = Record<string,string>;
export const buckets = ['retry_praktika_available','resume_mediref_available','resume_workflow_available',
  'manual_verification_required','historical_delivery_unconfirmed','legacy_no_workflow','genuinely_active_workflow','unresolved_no_safe_action'] as const;
export function specificReason(draft:WorkflowDraft, checks:Record<string,Eligibility>, hasParent:boolean) {
  const r=approvedWorkflow(draft);
  if(r.lookupUnavailable || r.message!==staleWorkflowMessage || Object.values(checks).some(e=>e.unavailable))return null;
  if(checks.workflow.eligible)return 'Periodontal continuation exhausted; safe read recovery is available.';
  if(['failed','unknown'].includes(r.branches.mediref))return 'MediRef delivery not confirmed.';
  if(!hasParent)return 'Historical workflow evidence requires review.';
  return null;
}
function captureClient(env:Environment, budget:number) {
  const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  if(url.hostname!==`${project}.supabase.co`)throw new Error('wrong_project');
  const rows:Record<string,Row[]>={report_drafts:[],providers:[],praktika_helper_jobs:[],mediref_helper_jobs:[],report_writing_audit_events:[],praktika_sessions:[],mediref_sessions:[]};
  const profile:Record<string,number>={},failures:Array<{table:string;category:string}>=[];let calls=0;
  const db=createClient(url.origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const u=new URL(String(input)),table=u.pathname.split('/').pop()!;
    if(u.origin!==url.origin||init?.method!=='GET'||!u.pathname.startsWith('/rest/v1/')||!(table in rows))throw new Error('read_only_boundary');
    if(++calls>budget){failures.push({table,category:'request_budget'});throw new Error('request_budget');}
    profile[table]=(profile[table]||0)+1;
    try {
      const response=await fetch(input,{...init,signal:init?.signal || AbortSignal.timeout(5000)});
      if(!response.ok)failures.push({table,category:`http_${response.status}`});
      else {const data=await response.clone().json();for(const row of Array.isArray(data)?data:[data]){
        const prior=rows[table].find(r=>r.id===row.id);if(prior)Object.assign(prior,row);else rows[table].push(row);
      }}
      return response;
    }catch(error){failures.push({table,category:'transport_or_parse_failure'});throw error;}
  }}});
  return {db,rows,profile,failures,calls:()=>calls};
}
async function auditProvider(provider:Provider,env:Environment) {
  // A fresh capture and the unchanged five-second projection deadline per provider.
  const capture=captureClient(env,45),{db,rows}=capture;
  rows.providers.push(provider);
  const fields='id,provider_id,patient_name,status,deleted_at,created_at,updated_at,provider_approved_at,uploaded_to_praktika,emailed_to_referrer_at,workflow_status,workflow_praktika_upload_status,workflow_icon_update_status,workflow_mediref_status,workflow_periodontal_chart_status,periodontal_chart_attached_at,periodontal_chart_attachment_name,periodontal_chart_attachment_error,praktika_patient_id,praktika_letter_icon_appointment_id,praktika_letter_icon_updated_at,praktika_letter_icon_update_response_preview';
  const drafts:Row[]=[];
  for(let offset=0;offset<2000;offset+=500){
    const {data,error}=await db.from('report_drafts').select(fields).eq('provider_id',provider.id).is('deleted_at',null)
      .in('status',['approved','uploaded_to_praktika']).order('id').range(offset,offset+499);
    if(error||!data)throw new Error('draft_read_failed');drafts.push(...data);
    if(data.length<500)break;if(offset===1500)throw new Error('draft_bound');
  }
  const projected=await projectWorkflowRecovery(db,drafts as Array<Row & {id:string}>);
  const remaining=projected.filter(shouldAppearInApproved);
  const parents=rows.praktika_helper_jobs.filter(j=>j.job_type==='complete_report_workflow' && remaining.some(d=>d.id===j.request?.reportDraftId));
  // Complete bounded pages, not a truncated safe-read set. No per-card queries.
  for(let offset=0;offset<parents.length;offset+=50){
    for(let page=0;page<2000;page+=500){
      const {data,error}=await db.from('praktika_helper_jobs').select('id,status,attempts,app_user_id,job_type,request,response')
        .in('request->>continuationId',parents.slice(offset,offset+50).map(j=>j.id))
        .in('job_type',['periodontal_chart_patient_perio_exam_ids','periodontal_chart_perio_exams']).order('id').range(page,page+499);
      if(error||!data)throw new Error('read_jobs_unavailable');
      if(data.length<500)break;if(page===1500)throw new Error('read_job_bound');
    }
  }
  const evaluators={retry:offlineGet('retry-praktika',rows,env.SUPABASE_SERVICE_ROLE_KEY),
    mediref:offlineGet('resume-mediref',rows,env.SUPABASE_SERVICE_ROLE_KEY),workflow:offlineGet('resume-workflow',rows,env.SUPABASE_SERVICE_ROLE_KEY)};
  const output=[];
  for(const d of remaining){
    const r=approvedWorkflow(d),parent=rows.praktika_helper_jobs.find(j=>j.id===token.continuationIntentId(d.id));
    const unavailable={eligible:false,unavailable:true,reason:'incomplete_evidence'};
    const checks=capture.failures.length||r.lookupUnavailable ? {retry:unavailable,mediref:unavailable,workflow:unavailable} :
      {retry:await evaluators.retry(d.id),mediref:await evaluators.mediref(d.id),workflow:await evaluators.workflow(d.id)};
    output.push({draftId:d.id,patientName:d.patient_name,providerId:provider.id,providerName:provider.name,
      bucket:actionBucket(d,checks,Boolean(parent)),status:r.status,message:r.message,branches:r.branches,
      listPartition:requiresWorkflowVerification(toDraftListItem(d,null))?'requires_verification':'approved',
      continuationContext:d.workflow_continuation_context || 'unknown',presentation:typistApprovedPresentation(d),
      lookupUnavailable:r.lookupUnavailable,checks,specificReason:specificReason(d,checks,Boolean(parent)),
      controls:{retry:r.praktikaRecovery,manualPraktika:r.praktikaRecovery,manualMediref:r.medirefRecovery,
        resumeMediref:checks.mediref.eligible,resumeWorkflow:checks.workflow.eligible},
      parent:parent?{status:parent.status,stage:parent.response?.stage,issue:parent.response?.issue}:null,
      medirefStates:rows.mediref_helper_jobs.filter(j=>j.payload?.draftId===d.id).map(j=>({status:j.status,
        sent:j.result?.sent===true,prepared:j.result?.prepared===true,remoteDraftSaved:j.result?.remoteDraftSaved===true})),
    });
  }
  const counts:Record<string,number>=Object.fromEntries(buckets.map(b=>[b,0]));
  for(const r of output)counts[r.bucket]++;
  return {providerId:provider.id,providerName:provider.name,observedAt:new Date().toISOString(),draftsRead:drafts.length,
    remaining:output.length,counts,requests:capture.calls(),profile:capture.profile,failures:capture.failures,
    incomplete:capture.failures.length>0||output.some(r=>r.lookupUnavailable||Object.values(r.checks).some(c=>c.unavailable)),records:output};
}
export async function auditSequentially<T>(providers:Provider[],audit:(p:Provider)=>Promise<T>) {
  const results:Array<{provider:Provider;result?:T;error?:string}>=[];
  for(const provider of providers){
    try{results.push({provider,result:await audit(provider)});}
    catch{results.push({provider,error:'provider_audit_incomplete'});}
  }
  return results;
}
async function main() {
  const env=parse(readFileSync('.env.local')),all=process.argv.includes('--all-active');
  const discovery=captureClient(env,2);
  let query=discovery.db.from('providers').select('id,name,is_active').eq('is_active',true).order('id').range(0,499);
  if(!all)query=query.eq('id',providerId);
  const {data:providers,error}=await query;
  if(error||!providers||providers.length>=500||(!all&&providers.length!==1))throw new Error('provider_discovery_failed');
  const audits=await auditSequentially(providers,async provider=>{
    const report=await auditProvider(provider,env);
    console.log(JSON.stringify({providerId:provider.id,remaining:report.remaining,incomplete:report.incomplete,requests:report.requests}));
    return report;
  });
  const completed=audits.flatMap(a=>a.result?[a.result]:[]),records=completed.flatMap(a=>a.records);
  const counts:Record<string,number>=Object.fromEntries(buckets.map(b=>[b,0]));for(const r of records)counts[r.bucket]++;
  const report={observedAt:new Date().toISOString(),activeProviders:providers.length,
    complete:audits.every(a=>a.result&&!a.result.incomplete),failedProviders:audits.filter(a=>a.error).map(a=>({providerId:a.provider.id,error:a.error})),
    remaining:records.length,counts,requests:discovery.calls()+completed.reduce((sum,a)=>sum+a.requests,0),providers:completed,
    limitations:['Eligibility assumes an active authorized Typist; POST locks and current actor authorization not exercised.',
      'Manual verification locking RPC and historical inspectors not invoked.','No external delivery inferred from prepared-only results.']};
  const path=all?'/private/tmp/all-active-approved-recovery-audit.json':'/private/tmp/ben-fu-approved-recovery-audit.json';
  writeFileSync(path,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({complete:report.complete,activeProviders:report.activeProviders,remaining:report.remaining,counts,requests:report.requests}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Read-only audit stopped; no automatic retry.');process.exitCode=1;});
