import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { retentionAuthorized, retentionPlan, retentionSettings, type RetentionDraft } from './retention';
import { resolveWorkflow, type WorkflowDraft, type WorkflowEvidence, type ReadJob } from './resolved-workflow';
const now = Date.now(), day = 86400000;
const stamp = (age=120) => new Date(now-age*day).toISOString();
const settings = {sourceDays:30,aiDays:30,finalDays:90,deleteFinalText:false};
function fixture(legacy=false) {
  const d: WorkflowDraft = {id:'synthetic',status:'approved',workflow_status:'completed',workflow_praktika_upload_status:'completed',
    workflow_icon_update_status:'skipped',workflow_mediref_status:'completed',workflow_periodontal_chart_status:'not_requested'};
  const parent: ReadJob = {id:'parent',job_type:'complete_report_workflow',status:'completed',app_user_id:'actor',
    request:{reportDraftId:d.id,actorUserId:'actor',options:{attachPeriodontalChart:false}},response:{stage:'mediref'},completed_at:stamp()};
  const upload: ReadJob = {id:'upload',job_type:'upload_report_to_praktika',status:'completed',request:{reportDraftId:d.id,...(!legacy?{continuationId:parent.id}:{})},
    response:{patient_communication:{iFileId:123}},updated_at:stamp()};
  const med: ReadJob = {id:'med',job_type:'send_mediref_letter',status:'completed',payload:{draftId:d.id,...(!legacy?{workflowContinuationId:parent.id}:{})},result:{prepared:true,sent:false},updated_at:stamp()};
  const e: WorkflowEvidence = {parent:legacy?undefined:parent,uploads:[upload],icons:[],mediref:[med],currentUploadId:upload.id,currentIconId:'icon',livePraktikaActors:new Set(),liveMediref:false};
  return {d,parent,upload,med,e};
}
function row(f=fixture()): RetentionDraft {
  return {...f.d,id:f.d.id!,updated_at:stamp(),completed_at:null,source_text:'PRIVATE_SOURCE',ai_generated_text:'PRIVATE_AI',edited_text:'PRIVATE_FINAL',workflow_resolved:resolveWorkflow(f.d,f.e,now)};
}
for(const defect of ['not_started','old_approval','running','failed','praktika_uncertain','mediref_uncertain','icon_failed','stale','missing','lookup','legacy_missing','manual_unresolved']) test('retention denies '+defect,()=>{
  const f=fixture();let d: RetentionDraft;
  if(defect==='not_started'||defect==='old_approval'){f.d.workflow_status=null;f.d.workflow_praktika_upload_status=null;f.e.parent=undefined;f.e.uploads=[];f.e.mediref=[];}
  if(['running','stale'].includes(defect)){f.parent.status='waiting';f.upload.status='pending';}
  if(defect==='failed')f.parent.status='failed';
  if(defect==='praktika_uncertain'){f.upload.status='failed';f.upload.response=null;}
  if(defect==='mediref_uncertain')f.med.status='failed';
  if(defect==='icon_failed'){f.d.workflow_icon_update_status='failed';}
  if(defect==='missing')f.e.uploads=[];
  if(defect==='legacy_missing'){f.e.parent=undefined;f.e.uploads=[];}
  if(defect==='manual_unresolved'){f.parent.response={manualVerification:{praktika:verification('praktika')}};f.med.status='failed';}
  d=row(f);
  if(defect==='lookup')d.workflowStatusStale=true;
  Object.assign(d,{provider_approved_at:stamp(900),uploaded_to_praktika_at:stamp(900),emailed_to_referrer_at:stamp(900),completed_at:stamp(900)});
  assert.equal(retentionPlan(d,settings,now),null);
});
function verification(integration: string) {return {integration,action:'manually_verified_completed',verifiedSuccess:true,actorUserId:'operator',draftId:'synthetic',intentId:'parent',priorJobId:integration==='praktika'?'upload':'med',verifiedAt:stamp(100)};}
test('modern completion uses terminal evidence, respects thresholds and preserves final text by default',()=>{
  const plan=retentionPlan(row(),settings,now)!;assert.deepEqual(plan.deletedFields,['source_text','ai_generated_text']);
  assert.equal(plan.update.completed_at,stamp());assert.equal(plan.update.edited_text,undefined);
  assert.equal(retentionPlan(row(),{...settings,deleteFinalText:true},now)!.update.edited_text,null);
});
test('fresh terminal timestamp prevents cleanup despite old draft timestamps',()=>{
  const f=fixture();f.parent.completed_at=stamp(1);const d=row(f);d.completed_at=stamp(900);
  assert.equal(retentionPlan(d,settings,now),null);
});
test('manual verification time supersedes failed attempt timestamps',()=>{
  const f=fixture();f.upload.status='failed';f.parent.response={manualVerification:{praktika:verification('praktika')}};
  const d=row(f);assert.equal(d.workflow_resolved!.status,'completed');assert.equal(retentionPlan(d,settings,now)!.completedAt,stamp(100));
});
for(const skip of ['skipped','not_requested'])test('legitimate optional branches '+skip,()=>{
  const f=fixture();f.e.mediref=[];f.d.workflow_mediref_status=skip;
  assert.ok(retentionPlan(row(f),settings,now));
});
for(const kind of ['Kim','Sapphiroula'])test(kind+' compatibility remains retention eligible',()=>{
  const f=fixture(true);f.d.workflow_periodontal_chart_status='skipped';
  if(kind==='Kim'){f.d.periodontal_chart_attached_at=stamp();f.d.periodontal_chart_attachment_name='chart.pdf';}
  else f.d.periodontal_chart_attachment_error='Periodontal chart was requested, but no periodontal chart was found.';
  assert.ok(retentionPlan(row(f),settings,now));
});
test('missing terminal dates never use created/claimed/approval timestamps',()=>{
  const f=fixture(true);delete f.upload.updated_at;delete f.med.updated_at;
  f.upload.created_at=f.upload.locked_at=stamp();f.med.created_at=stamp();
  const d=row(f);assert.equal(d.workflow_resolved!.status,'completed');assert.equal(d.workflow_resolved!.completedAt,null);
  assert.equal(retentionPlan(d,settings,now),null);
});
test('missing child terminal date may use authoritative completed parent timestamp',()=>{
  const f=fixture();delete f.upload.updated_at;assert.equal(retentionPlan(row(f),settings,now)!.completedAt,stamp());
});
test('future completion timestamp denied',()=>{const f=fixture();f.parent.completed_at=stamp(-1);assert.equal(retentionPlan(row(f),settings,now),null);});
test('existing completed_at is preserved but cannot accelerate age',()=>{const d=row();d.completed_at=stamp(500);assert.equal(retentionPlan(d,settings,now)!.update.completed_at,undefined);});
test('evidence unavailable denies and leaves text unchanged',()=>{
  const d=row();d.workflow_resolved!.lookupUnavailable=true;const before=JSON.stringify(d);
  assert.equal(retentionPlan(d,settings,now),null);assert.equal(JSON.stringify(d),before);
});
for(const value of ['', '0','-1','NaN','1.5','Infinity'])test('invalid retention threshold rejected '+value,()=>{
  assert.equal(retentionSettings({RETENTION_SOURCE_DAYS:value}),null);
});
test('default settings unchanged',()=>assert.deepEqual(retentionSettings({}),settings));
const secret='synthetic-retention-secret';
for(const method of ['GET','POST'])for(const variant of ['missing','blank','incorrect','query_only','valid'])test(method+' authorization '+variant,()=>{
  const env: Record<string, string | undefined>={RETENTION_CLEANUP_SECRET:secret,CRON_SECRET:secret};
  if(variant==='missing')delete env.RETENTION_CLEANUP_SECRET;if(variant==='blank')env.RETENTION_CLEANUP_SECRET=' ';
  const req=new Request('https://example.invalid/?secret='+secret,{method,headers:variant==='query_only'?{}:{authorization:'Bearer '+(variant==='incorrect'?'wrong':secret)}});
  assert.equal(retentionAuthorized(req,env),variant==='valid');
});
test('GET requires configured matching cron secret, POST retains explicit retention authorization',()=>{
  for(const cron of [undefined,'','other'])assert.equal(retentionAuthorized(new Request('https://example.invalid',{headers:{authorization:'Bearer '+secret}}),{RETENTION_CLEANUP_SECRET:secret,CRON_SECRET:cron}),false);
});
function routeHarness(mode='success') {
  let reads=0,writes=0,clients=0,enrichments=0;const inserts: unknown[]=[];const updates: unknown[]=[];
  const draft=row();const db={from(table:string){
    assert.ok(['report_drafts','report_writing_audit_events'].includes(table));
    let mutation=false;
    const q={select(){return q;},is(){return q;},eq(){return q;},order(){return q;},
      limit:async()=>({data:[draft],error:null}),
      update(value:unknown){writes++;mutation=true;updates.push(value);return q;},
      insert:async(value:unknown)=>{inserts.push(value);return {error:mode==='audit_error'?{}:null};},
      maybeSingle:async()=>mutation?{data:mode==='race'?null:{id:draft.id},error:null}:{data:{...draft},error:null}};
    reads++;return q;
  }};
  const exports: Record<string,(req:Request)=>Promise<Response>>={};
  const source=readFileSync(new URL('../../app/api/report-writing/retention-cleanup/route.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    exports,process:{env:{RETENTION_CLEANUP_SECRET:secret,CRON_SECRET:secret}},Request,Response,Buffer,Date,
    require:(name:string)=>{
      if(name==='next/server')return {NextResponse:Response};
      if(name==='@supabase/supabase-js')return {createClient:()=>{clients++;return db;}};
      if(name.endsWith('/retention'))return {retentionAuthorized,retentionPlan,retentionSettings};
      if(name.endsWith('/workflow-recovery'))return {projectWorkflowRecovery:async(_db:unknown,rows:RetentionDraft[])=>{
        enrichments++;if(mode==='lookup_error')throw Error('PRIVATE_DATABASE_ERROR');
        return rows.map(d=>mode==='incomplete'||mode==='became_incomplete'&&enrichments>1?{...d,workflow_resolved:{...d.workflow_resolved,status:'needs_attention'}}:d);
      }};
      throw Error('Unexpected dependency');
    },
  });
  return {exports,state:()=>({reads,writes,clients,inserts,updates})};
}
for(const method of ['GET','POST'])test(method+' unauthorized never accesses database',async()=>{
  const h=routeHarness();const response=await h.exports[method](new Request('https://example.invalid',{method}));
  assert.equal(response.status,401);assert.equal(h.state().clients,0);
});
for(const mode of ['incomplete','became_incomplete','lookup_error'])test('handler fails closed '+mode,async()=>{
  const h=routeHarness(mode);const response=await h.exports.GET(new Request('https://example.invalid',{headers:{authorization:'Bearer '+secret}}));
  assert.equal(h.state().writes,0);assert.doesNotMatch(await response.text(),/PRIVATE/);
});
test('authenticated scheduler performs intended completed-only cleanup with private audit',async()=>{
  const h=routeHarness();const r=await h.exports.GET(new Request('https://example.invalid',{headers:{authorization:'Bearer '+secret}}));
  const body=await r.json();assert.equal(body.sourceDeleted,1);assert.equal(body.aiDeleted,1);assert.equal(body.finalDeleted,0);
  assert.equal(h.state().writes,1);assert.equal(h.state().inserts.length,1);
  assert.doesNotMatch(JSON.stringify(h.state().inserts)+JSON.stringify(body),/PRIVATE_SOURCE|PRIVATE_AI|PRIVATE_FINAL/);
});
test('concurrent draft update records no cleanup success/audit',async()=>{
  const h=routeHarness('race');const r=await h.exports.POST(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer '+secret}}));
  assert.equal((await r.json()).sourceDeleted,0);assert.equal(h.state().inserts.length,0);
});
test('audit persistence failure is visible',async()=>{
  const h=routeHarness('audit_error');const r=await h.exports.GET(new Request('https://example.invalid',{headers:{authorization:'Bearer '+secret}}));
  const body=await r.json();assert.equal(body.success,false);assert.equal(body.auditFailures,1);
});
test('route has no external execution, child-job creation or approval timestamp fallback',()=>{
  const source=readFileSync(new URL('../../app/api/report-writing/retention-cleanup/route.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|\.rpc\(|helper_jobs|provider_approved_at|uploaded_to_praktika_at|emailed_to_referrer_at/);
  assert.match(source,/eq\('updated_at', fresh.updated_at\)/);
});
