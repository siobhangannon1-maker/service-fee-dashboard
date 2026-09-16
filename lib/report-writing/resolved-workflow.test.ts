import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveWorkflow, approvedWorkflow, shouldAppearInApproved, WORKFLOW_STALE_MS, staleWorkflowMessage, type WorkflowDraft, type WorkflowEvidence, type ReadJob } from './resolved-workflow';
import { projectWorkflowRecovery } from './workflow-recovery';
import { continuationIntentId, continuationChildId } from './workflow-continuation-token';
const now = Date.parse('2026-09-15T12:00:00Z');
const iso = (age=1000) => new Date(now-age).toISOString();
function fixture() {
  const d: WorkflowDraft = { id:'synthetic-draft',status:'approved',workflow_status:'running',workflow_praktika_upload_status:'running',
    workflow_icon_update_status:'skipped',workflow_mediref_status:'completed',workflow_periodontal_chart_status:'not_requested' };
  const parent: ReadJob = { id:continuationIntentId(d.id!),job_type:'complete_report_workflow',status:'waiting',app_user_id:'actor',
    request:{reportDraftId:d.id,actorUserId:'actor',options:{attachPeriodontalChart:false}},response:{stage:'upload'},updated_at:iso() };
  const upload: ReadJob = { id:continuationChildId(parent.id,'upload_report_to_praktika'),job_type:'upload_report_to_praktika',status:'pending',app_user_id:'actor',
    request:{reportDraftId:d.id,continuationId:parent.id},created_at:iso(),response:null };
  const med: ReadJob = { id:'med',job_type:'send_mediref_letter',status:'completed',payload:{draftId:d.id,workflowContinuationId:parent.id,attachments:[]},
    result:{prepared:true,sent:false},created_at:iso(2000),updated_at:iso(1500) };
  const e: WorkflowEvidence = {parent,uploads:[upload],icons:[],mediref:[med],currentUploadId:upload.id,
    currentIconId:continuationChildId(parent.id,'update_praktika_letter_icons'),livePraktikaActors:new Set(['actor']),liveMediref:true};
  return {d,e,parent,upload,med};
}
function completed() { const f=fixture(); f.parent.status='completed';f.upload.status='completed';f.upload.response={patient_communication:{iFileId:123}};return f; }
function resolved(f: ReturnType<typeof fixture>) { return resolveWorkflow(f.d,f.e,now); }
function appears(f: ReturnType<typeof fixture>) { return shouldAppearInApproved({...f.d,workflow_resolved:resolved(f)}); }
test('recent durable work with live owner is Completing',()=>{assert.equal(resolved(fixture()).status,'completing');});
test('stale pending/processing work stays visible and needs attention',()=>{
  for(const status of ['pending','processing']){const f=fixture();f.upload.status=status;f.upload.created_at=iso(WORKFLOW_STALE_MS+1);f.med.created_at=f.med.updated_at=iso(WORKFLOW_STALE_MS+1);
    assert.equal(resolved(f).status,'needs_attention');assert.equal(resolved(f).message,staleWorkflowMessage);assert.equal(appears(f),true);}
});
test('fresh parent polling, child generic updates and liveness never renew progress',()=>{
  const f=fixture();f.upload.created_at=iso(WORKFLOW_STALE_MS+1);f.upload.updated_at=iso();f.parent.updated_at=iso();f.med.created_at=f.med.updated_at=iso(WORKFLOW_STALE_MS+1);
  assert.equal(resolved(f).status,'needs_attention');assert.equal(resolved(f).lastProgressAt,now-WORKFLOW_STALE_MS-1);
});
test('new claim is meaningful progress',()=>{const f=fixture();f.upload.created_at=iso(WORKFLOW_STALE_MS+1);f.upload.locked_at=iso();assert.equal(resolved(f).status,'completing');});
test('disconnected owner does not sustain Completing',()=>{const f=fixture();f.e.livePraktikaActors=new Set();assert.equal(resolved(f).status,'needs_attention');});
test('missing current child does not become Completing because another branch is active',()=>{const f=fixture();f.e.uploads=[];f.med.status='processing';assert.equal(resolved(f).status,'needs_attention');});
test('Andrew-style failure beats stale message and preserves recovery candidates',()=>{
  const f=fixture();f.parent.status='failed';f.upload.status='failed';f.upload.created_at=iso(WORKFLOW_STALE_MS+1);
  const r=resolved(f);assert.equal(r.message,'Praktika upload needs verification.');assert.equal(r.praktikaRecovery,true);assert.equal(r.medirefRecovery,false);
});
test('current replacement supersedes failed original',()=>{
  const f=completed();const old={...f.upload,id:'old',status:'failed'};f.e.uploads.push(old);
  f.parent.response={stage:'upload',retryUploadId:f.upload.id};assert.equal(resolved(f).branches.praktika,'completed');assert.equal(appears(f),false);
});
test('active competing upload fails closed',()=>{const f=completed();f.e.uploads.push({...f.upload,id:'competing',status:'pending'});assert.equal(appears(f),true);assert.equal(resolved(f).praktikaRecovery,false);});
test('wrong child linkage cannot establish upload success',()=>{const f=completed();f.upload.request={reportDraftId:f.d.id,continuationId:'other'};assert.equal(appears(f),true);});
test('completed job without positive upload confirmation stays unresolved',()=>{const f=completed();f.upload.response={success:true};assert.equal(appears(f),true);});
test('seven-style chart pending corrected only with complete authoritative attachment evidence',()=>{
  const f=completed();f.d.workflow_status='completed';f.d.workflow_periodontal_chart_status='pending';
  f.d.periodontal_chart_attached_at=iso();f.d.periodontal_chart_attachment_name='synthetic-chart.pdf';
  f.med.payload!.attachments=[{fileName:'synthetic-letter.pdf'},{fileName:'synthetic-chart.pdf'}];
  assert.equal(resolved(f).branches.periodontal,'completed');assert.equal(appears(f),false);assert.equal(f.d.workflow_periodontal_chart_status,'pending');
  f.parent.status='waiting';assert.equal(appears(f),true);
});
for(const defect of ['error','missing_attachment','duplicate_attachment','missing_timestamp'])test(`chart evidence ${defect} retains Approved`,()=>{
  const f=completed();f.d.workflow_periodontal_chart_status='running';f.d.periodontal_chart_attached_at=iso();f.d.periodontal_chart_attachment_name='chart.pdf';f.med.payload!.attachments=[{fileName:'chart.pdf'}];
  if(defect==='error')f.d.periodontal_chart_attachment_error='PRIVATE_ERROR';
  if(defect==='missing_attachment')f.med.payload!.attachments=[];
  if(defect==='duplicate_attachment')f.med.payload!.attachments=[{fileName:'chart.pdf'},{fileName:'chart.pdf'}];
  if(defect==='missing_timestamp')f.d.periodontal_chart_attached_at=null;
  assert.equal(appears(f),true);assert.equal(resolved(f).status,'needs_attention');
});
test('completed MediRef child survives missing draft projection, without completing upload',()=>{
  const f=fixture();f.d.workflow_mediref_status='pending';assert.equal(resolved(f).branches.mediref,'completed');assert.equal(appears(f),true);assert.equal(f.d.workflow_mediref_status,'pending');
});
test('legacy completed MediRef corrects its branch only',()=>{const f=fixture();delete f.e.parent;f.e.uploads=[];delete f.med.payload!.workflowContinuationId;assert.equal(resolved(f).branches.mediref,'completed');assert.equal(appears(f),true);});
test('newer failed MediRef attempt is not hidden by older completion',()=>{const f=fixture();f.e.mediref.push({...f.med,id:'new',status:'failed',created_at:iso(500)});assert.equal(resolved(f).branches.mediref,'failed');});
test('raw errors are absent from safe presentation, source draft unchanged',()=>{
  const f=fixture();f.med.status='failed';Object.assign(f.d,{workflow_error:'locator.type PRIVATE_PATIENT selector password'});
  const before=JSON.stringify(f.d);const r=resolved(f);assert.equal(r.message,'MediRef needs verification.');assert.doesNotMatch(JSON.stringify(r),/locator|PRIVATE|selector|password/);assert.equal(JSON.stringify(f.d),before);
});
test('Charlize-style icon failure has specific message and no upload/MediRef controls',()=>{
  const f=completed();f.parent.status='failed';f.parent.response={stage:'icon'};
  f.e.icons=[{...f.upload,id:f.e.currentIconId!,job_type:'update_praktika_letter_icons',status:'failed'}];
  const r=resolved(f);assert.equal(r.message,'Praktika appointment icon update needs attention.');assert.equal(r.praktikaRecovery,false);assert.equal(r.medirefRecovery,false);assert.equal(appears(f),true);
});
test('failed parent is not erased by superficially completed children',()=>{const f=completed();f.parent.status='failed';assert.equal(appears(f),true);});
test('approved not started is retained',()=>{const f=fixture();f.d={id:f.d.id,status:'approved'};delete f.e.parent;f.e.uploads=[];f.e.mediref=[];assert.equal(resolved(f).status,'not_started');assert.equal(appears(f),true);});
test('legacy flags and workflow projections alone never hide a draft',()=>{assert.equal(shouldAppearInApproved({status:'uploaded_to_praktika',uploaded_to_praktika:true,emailed_to_referrer_at:iso(),workflow_status:'completed'}),true);});
test('lookup failure uses safe fallback and retains membership',()=>{const d={status:'approved',workflow_status:'running'};assert.equal(approvedWorkflow(d).status,'needs_attention');assert.equal(shouldAppearInApproved(d),true);});
test('valid manual proof remains accepted and no raw error emitted',()=>{
  const f=completed();f.e.uploads=[];f.parent.response={manualVerification:{praktika:{integration:'praktika',action:'manually_verified_completed',actorUserId:'actor',verifiedAt:iso(),priorJobId:'old',attempt:1,draftId:f.d.id,intentId:f.parent.id,verifiedSuccess:true}}};
  assert.equal(resolved(f).branches.praktika,'completed');assert.equal(appears(f),false);
});
test('legacy failed MediRef does not broaden Mark eligibility',()=>{const f=fixture();delete f.e.parent;f.med.status='failed';delete f.med.payload!.workflowContinuationId;f.d.workflow_mediref_status='failed';assert.equal(resolved(f).medirefRecovery,false);});
test('read resolver contains no mutation/execution entry points',()=>{
  const source=readFileSync('lib/report-writing/resolved-workflow.ts','utf8')+readFileSync('lib/report-writing/workflow-recovery.ts','utf8');
  assert.doesNotMatch(source,/\.(insert|update|upsert|delete|rpc)\s*\(/);
  const ui=readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx','utf8');
  const card=ui.slice(ui.indexOf('{approvedWorkflow(draft).status'),ui.indexOf('onQueued={() => { void loadDrafts',ui.indexOf('{approvedWorkflow(draft).status')));
  assert.doesNotMatch(card,/\{draft.workflow_error\}/);assert.match(card,/approvedWorkflow\(draft\).praktikaRecovery/);
});
test('real read projection returns only safe resolved metadata and never mutates',async()=>{
  const f=completed();const tables:Record<string,ReadJob[]>={praktika_helper_jobs:[f.parent,f.upload],mediref_helper_jobs:[f.med]};
  const db={from(table:string){let filtered=tables[table]||[];const q:Record<string,unknown>={};
    q.select=()=>q;q.eq=(key:string,value:unknown)=>{filtered=filtered.filter(j=>(j as unknown as Record<string,unknown>)[key]===value);return q;};
    q.in=(key:string,values:unknown[])=>{filtered=filtered.filter(j=>values.includes(key==='request->>reportDraftId'?j.request?.reportDraftId:key==='payload->>draftId'?j.payload?.draftId:(j as unknown as Record<string,unknown>)[key]));return q;};
    q.or=()=>q;q.order=()=>q;q.range=()=>q;q.abortSignal=()=>q;q.then=(fn:(v:unknown)=>unknown)=>Promise.resolve({data:filtered,error:null}).then(fn);return q;
  }};
  const before=JSON.stringify(f.d);const [d]=await projectWorkflowRecovery(db as never,[{...f.d,id:f.d.id!}]);
  assert.equal(d.workflow_resolved?.status,'completed');assert.equal(JSON.stringify(f.d),before);
  assert.equal(shouldAppearInApproved(d),false);
});
test('exact 30-minute boundary is stale',()=>{const f=fixture();f.upload.created_at=iso(WORKFLOW_STALE_MS);f.med.created_at=f.med.updated_at=iso(WORKFLOW_STALE_MS);assert.equal(resolved(f).status,'needs_attention');});
test('processing needs a claim as well as current helper availability',()=>{const f=fixture();f.upload.status='processing';assert.equal(resolved(f).status,'needs_attention');f.upload.locked_at=iso();f.upload.locked_by='synthetic-worker';assert.equal(resolved(f).status,'completing');});
test('invalid manual verification cannot establish success',()=>{const f=completed();f.e.uploads=[];f.parent.response={manualVerification:{praktika:{action:'manually_verified_completed',verifiedSuccess:true,draftId:'wrong'}}};assert.equal(appears(f),true);});
test('completed MediRef without accepted result remains uncertain',()=>{const f=completed();f.med.result={success:true};assert.equal(resolved(f).branches.mediref,'failed');assert.equal(appears(f),true);});
test('auxiliary database failure returns durable row with safe unresolved presentation',async()=>{
  const f=fixture();const original=JSON.stringify(f.d);
  const db={from(){const q={select:()=>q,eq:()=>q,or:()=>q,in:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
    then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:{message:'PRIVATE_DATABASE_ERROR'}}).then(fn)};return q;}};
  const [d]=await projectWorkflowRecovery(db as never,[{...f.d,id:f.d.id!}]);
  assert.equal(d.workflow_praktika_upload_status,'running');assert.equal(d.workflow_resolved?.lookupUnavailable,true);
  assert.equal(shouldAppearInApproved(d),true);assert.doesNotMatch(JSON.stringify(d),/PRIVATE_DATABASE_ERROR/);assert.equal(JSON.stringify(f.d),original);
});
test('failed evidence batch cannot hide rows or spoil a separate successful batch',async()=>{
  const drafts=Array.from({length:101},(_,i)=>({id:`synthetic-${i}`,status:'approved'}));
  const db={from(){let broken=false;const q={select:()=>q,eq:()=>q,or:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
    in:(key:string,ids:string[])=>{if(key==='request->>reportDraftId'&&ids.includes('synthetic-0'))broken=true;return q;},
    then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:broken?null:[],error:broken?{message:'PRIVATE'}:null}).then(fn)};return q;}};
  const output=await projectWorkflowRecovery(db as never,drafts) as Array<typeof drafts[number]&WorkflowDraft>;
  assert.equal(output.length,101);assert.equal(output[0].workflow_resolved?.lookupUnavailable,true);
  assert.equal(output[100].workflow_resolved?.status,'not_started');assert.ok(output.every(shouldAppearInApproved));
});
function kimFixture() {
  const f=completed();
  delete f.e.parent;
  f.d.workflow_status='completed';f.d.status='uploaded_to_praktika';f.d.uploaded_to_praktika=true;
  f.d.workflow_praktika_upload_status='completed';f.d.workflow_icon_update_status='completed';f.d.workflow_mediref_status='completed';
  f.d.workflow_periodontal_chart_status='skipped';f.d.periodontal_chart_attached_at=iso(40*86400000);
  f.d.periodontal_chart_attachment_name='synthetic-chart.pdf';f.d.emailed_to_referrer_at=iso(40*86400000);
  f.upload.request={reportDraftId:f.d.id};f.upload.id='legacy-upload';
  f.e.icons=[{...f.upload,id:'legacy-icon',job_type:'update_praktika_letter_icons',response:{success:true}}];
  f.med.payload={draftId:f.d.id,attachments:[{fileName:'synthetic-chart.pdf'}]};
  f.med.result={prepared:true,remoteDraftSaved:true,sent:false,recipientMatchingSkipped:true};
  for(const j of [f.upload,...f.e.icons,f.med]){j.created_at=iso(40*86400000);j.updated_at=iso(40*86400000);}
  f.e.livePraktikaActors=new Set();f.e.liveMediref=false;
  return f;
}
test('Kim evidence: legacy IDs, skipped chart with retained metadata, old prepare-only completion',()=>{
  const f=kimFixture();const r=resolved(f);
  assert.equal(r.status==='needs_attention',false);assert.notEqual(r.message,staleWorkflowMessage);
  assert.equal(r.status,'completed');assert.equal(appears(f),false);
  assert.deepEqual(r.branches,{praktika:'completed',icon:'completed',mediref:'completed',periodontal:'skipped'});
  assert.equal(r.praktikaRecovery,false);assert.equal(r.medirefRecovery,false);
});
for(const change of ['running','chart_error','missing_upload','missing_icon','missing_mediref','negative_upload','sent_false_only','retry','modern_link','other_parent'])test(`legacy terminal evidence remains fail-safe: ${change}`,()=>{
  const f=kimFixture();
  if(change==='running')f.d.workflow_mediref_status='running';
  if(change==='chart_error')f.d.periodontal_chart_attachment_error='synthetic error';
  if(change==='missing_upload')f.e.uploads=[];
  if(change==='missing_icon')f.e.icons=[];
  if(change==='missing_mediref')f.e.mediref=[];
  if(change==='negative_upload')f.upload.response={success:true};
  if(change==='sent_false_only')f.med.result={sent:false};
  if(change==='retry')f.e.uploads.push({...f.upload,id:'replacement',status:'failed',request:{...f.upload.request,manualRetry:{priorJobId:f.upload.id}}});
  if(change==='modern_link')f.upload.request!.continuationId='missing-parent';
  if(change==='other_parent')f.e.hasOtherParent=true;
  assert.equal(appears(f),true);assert.equal(resolved(f).status,'needs_attention');
});
test('modern failed replacement supersedes earlier confirmed upload',()=>{
  const f=completed();const earlier={...f.upload,id:'earlier'};f.e.uploads.push(earlier);
  f.upload.status='failed';f.parent.status='failed';f.parent.response={stage:'upload',retryUploadId:f.upload.id};
  assert.equal(appears(f),true);assert.equal(resolved(f).status,'needs_attention');
});
test('explicit modern chart request is not overridden by skipped draft projection',()=>{
  const f=completed();f.parent.request!.options={attachPeriodontalChart:true};f.d.workflow_periodontal_chart_status='skipped';
  assert.equal(appears(f),true);
});
function legacyUnavailableChart() {
  const f=kimFixture();f.d.periodontal_chart_attached_at=null;f.d.periodontal_chart_attachment_name=null;
  f.d.periodontal_chart_attachment_error='Periodontal chart was requested, but no periodontal chart was found.';
  f.med.payload!.attachments=[{fileName:'synthetic-letter.pdf'}];return f;
}
test('Sapphiroula legacy unavailable-chart skip completes without changing audit or inventing an attachment',()=>{
  const f=legacyUnavailableChart();const before=JSON.stringify(f);const r=resolved(f);
  assert.equal(r.status,'completed');assert.equal(r.branches.periodontal,'skipped');assert.equal(appears(f),false);
  assert.equal(JSON.stringify(f),before);assert.equal(f.d.periodontal_chart_attached_at,null);
  assert.equal(f.d.periodontal_chart_attachment_error,'Periodontal chart was requested, but no periodontal chart was found.');
});
for(const defect of ['modern_required','transport','generation','malformed','not_completed','failed_upload','failed_icon','failed_mediref','replacement','missing_child','attachment'])test(`legacy chart exception excludes ${defect}`,()=>{
  const f=legacyUnavailableChart();
  if(defect==='modern_required'){f.e.parent=f.parent;f.parent.request!.options={attachPeriodontalChart:true};f.upload.request!.continuationId=f.parent.id;}
  if(defect==='transport')f.d.periodontal_chart_attachment_error='Praktika read is temporarily unavailable.';
  if(defect==='generation')f.d.periodontal_chart_attachment_error='Failed to generate periodontal chart.';
  if(defect==='malformed')f.d.periodontal_chart_attachment_error='Invalid chart data.';
  if(defect==='not_completed')f.d.workflow_status='running';
  if(defect==='failed_upload')f.upload.status='failed';
  if(defect==='failed_icon')f.e.icons[0].status='failed';
  if(defect==='failed_mediref')f.med.status='failed';
  if(defect==='replacement')f.e.uploads.push({...f.upload,id:'replacement',status:'failed'});
  if(defect==='missing_child')f.e.uploads=[];
  if(defect==='attachment')f.d.periodontal_chart_attachment_name='unexpected-chart.pdf';
  assert.equal(appears(f),true);assert.notEqual(resolved(f).branches.periodontal,'skipped');
});
