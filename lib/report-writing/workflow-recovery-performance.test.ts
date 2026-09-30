import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { retentionPlan, retentionSettings } from './retention';
import { createWorkflowEvidenceReader } from './historical-workflow-reader';
import { projectWorkflowRecovery } from './workflow-recovery';
import { continuationIntentId, continuationChildId } from './workflow-continuation-token';
import { shouldAppearInApproved } from './resolved-workflow';

function page(run: (start:number, signal:AbortSignal) => Promise<{data:unknown[]|null,error:unknown}>) {
  let start=0, signal:AbortSignal;
  const q={order:()=>q,range:(a:number)=>{start=a;return q;},abortSignal:(s:AbortSignal)=>{signal=s;return q;},
    then:<T=unknown,U=never>(yes?:((r:{data:unknown[]|null,error:unknown})=>T|PromiseLike<T>)|null,no?:((e:unknown)=>U|PromiseLike<U>)|null)=>run(start,signal).then(yes,no)};
  return q;
}
test('shared reader bounds independent requests to eight and preserves one signal',async()=>{
  const signal=AbortSignal.timeout(5000),r=createWorkflowEvidenceReader(signal);let active=0,peak=0,calls=0;
  const query=()=>page(async(_start,s)=>{assert.equal(s,signal);calls++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));active--;return {data:[],error:null};});
  await Promise.all([r.read(Array.from({length:1200},(_,i)=>String(i)),query),r.read(['other'],query)]);
  assert.equal(calls,13);assert.equal(peak,8);
});
test('failed later page discards the entire batch but preserves a complete independent batch',async()=>{
  const r=createWorkflowEvidenceReader(AbortSignal.timeout(5000));
  const result=await r.read(['bad','good'],ids=>page(async start=>ids[0]==='good'?{data:[{id:'good'}],error:null}:
    start===0?{data:Array.from({length:500},()=>({id:'partial'})),error:null}:{data:null,error:{}}),1);
  assert.deepEqual(result.rows,[{id:'good'}]);assert.deepEqual([...result.failed],['bad']);
});
test('later reads inherit remaining deadline and queued work is not invoked after expiry',async()=>{
  const controller=new AbortController(),r=createWorkflowEvidenceReader(controller.signal);let calls=0;
  await r.read(['first'],()=>page(async()=>({data:[],error:null})));
  controller.abort();
  const result=await r.read(Array.from({length:1000},(_,i)=>String(i)),()=>{calls++;return page(async()=>({data:[],error:null}));});
  assert.equal(calls,0);assert.equal(result.failed.size,1000);assert.equal(result.rows.length,0);
});
test('524 drafts batch parents and children, reuse loaded child evidence, and never cache across requests',async()=>{
  const drafts=Array.from({length:524},(_,i)=>({id:`synthetic-${i}`}));
  const calls:Array<{kind:string;count:number}>=[];const signals=new Set<AbortSignal>();
  const db={from(){let kind='',ids:string[]=[],parentIds:string[]=[];const q={select:()=>q,order:()=>q,range:()=>q,
    eq:(_k:string,v:string)=>{kind=v;return q;},in:(_k:string,v:string[])=>{ids=v;return q;},
    or:(v:string)=>{parentIds=v.match(/^id\.in\.\(([^)]*)\)/)![1].split(',');return q;},
    abortSignal:(s:AbortSignal)=>{signals.add(s);return q;},
    then:(resolve:(x:unknown)=>unknown)=>{calls.push({kind,count:(parentIds.length?parentIds:ids).length});return Promise.resolve({error:null,
      data:parentIds.length?parentIds.map(id=>({id,status:'failed',response:{stage:'upload'}})):
        ids.map(id=>({id,status:'failed'}))}).then(resolve);}};return q;}};
  for(let i=0;i<2;i++){
    const output=await projectWorkflowRecovery(db as never,drafts);
    assert.ok(output.every(d=>(d as {workflow_praktika_upload_status?:string}).workflow_praktika_upload_status==='failed'));
  }
  assert.equal(signals.size,2);
  assert.equal(calls.filter(c=>c.kind==='complete_report_workflow').length,22);
  assert.ok(calls.filter(c=>c.kind==='complete_report_workflow').every(c=>c.count<=50));
  assert.equal(calls.filter(c=>c.kind==='upload_report_to_praktika').length,12);
  assert.ok(calls.every(c=>c.count<=100));
});
test('modern loaded child is reused without a separate child request',async()=>{
  const id='synthetic',parent=continuationIntentId(id),child=continuationChildId(parent,'upload_report_to_praktika');let childQueries=0;
  const db={from(table:string){let kind='',parents=false;const q={select:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
    eq:(_k:string,v:string)=>{kind=v;return q;},or:()=>{parents=true;return q;},in:()=>q,
    then:(resolve:(x:unknown)=>unknown)=>{if(kind==='upload_report_to_praktika')childQueries++;
      return Promise.resolve({error:null,data:parents?[{id:parent,status:'failed',response:{stage:'upload'}}]:table==='praktika_helper_jobs'?
        [{id:child,job_type:'upload_report_to_praktika',status:'failed',request:{reportDraftId:id}}]:[]}).then(resolve);}};return q;}};
  const [out]=await projectWorkflowRecovery(db as never,[{id,status:'approved'}]);
  assert.equal(childQueries,0);assert.equal(shouldAppearInApproved(out),true);
});

test('524 UUID draft queries stay below 5000 URL characters with the real PostgREST builder',async()=>{
  const urls:URL[]=[];
  const db=createClient('https://fixture.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    assert.equal(init?.method,'GET');urls.push(new URL(String(input)));return Response.json([]);
  }}});
  const drafts=Array.from({length:524},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,status:'approved'}));
  await projectWorkflowRecovery(db,drafts);
  assert.equal(urls.length,29);
  assert.equal(urls.filter(u=>u.pathname.endsWith('/report_writing_audit_events')).length,6);assert.ok(urls.every(u=>u.toString().length<5000));
  assert.equal(urls.filter(u=>u.searchParams.get('job_type')==='eq.complete_report_workflow').length,11);
});
test('actual five-second deadline aborts a later stage without granting a fresh budget',async()=>{
  let common:AbortSignal|undefined;const started=performance.now();
  const db={from(){let parent=false,signal:AbortSignal;const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:()=>q,
    or:()=>{parent=true;return q;},abortSignal:(s:AbortSignal)=>{signal=s;if(common)assert.equal(s,common);common=s;return q;},
    then:(resolve:(v:unknown)=>unknown)=>new Promise(r=>{
      if(parent)setTimeout(()=>r({data:[{id:continuationIntentId('draft'),status:'failed',response:{stage:'upload'}}],error:null}),100);
      else {const timer=setTimeout(()=>r({data:[],error:null}),10000);signal.addEventListener('abort',()=>{clearTimeout(timer);r({data:null,error:{}});},{once:true});}
    }).then(resolve)};return q;}};
  const [d]=await projectWorkflowRecovery(db as never,[{id:'draft',workflow_status:'running'}]);
  assert.equal(common?.aborted,true);assert.ok(performance.now()-started<5800);
  assert.equal((d as {workflowStatusStale?:boolean}).workflowStatusStale,true);
  assert.equal(shouldAppearInApproved({...d,status:'approved'}),true);
  assert.equal(retentionPlan({...d,status:'approved',updated_at:new Date(0).toISOString()},retentionSettings({})!),null);
});

function reconciledFixture(index: number) {
  const id=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
  const draft={id,status:'approved',workflow_status:'completed',created_at:'2026-01-01T00:00:00Z'};
  const event={id:`event-${index}`,entity_id:id,action:'system_historical_reconciliation',details:{
    eventId:`event-${index}`,draftId:id,epoch:'2026-01-01T00:00:00.000000Z/unrecorded',
    source:'controlled_historical_cleanup',contract:'historical-v1',reconciliationVersion:1,
    reconciledAt:'2026-01-02T00:00:00Z',historicalCompletedAt:'2026-01-01T00:00:00Z',
    branches:{praktika:{outcome:'completed',basis:'system_verified_historical_completion',jobId:'upload',auditId:'audit'},
      mediref:{outcome:'skipped'},icon:{outcome:'skipped'},periodontal:{outcome:'skipped'}}}};
  return {draft,event};
}
function eventDatabase(events: unknown[], failPage = -1) {
  const calls:URL[]=[];
  const db=createClient('https://fixture.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    assert.equal(init?.method,'GET');const url=new URL(String(input));calls.push(url);
    if(!url.pathname.endsWith('/report_writing_audit_events'))return Response.json([]);
    const start=Number(url.searchParams.get('offset') || 0);
    if(start===failPage)return Response.json({message:'unavailable'},{status:400});
    const filter=url.searchParams.get('entity_id') || '';
    const rows=events.filter(e=>filter.includes((e as {entity_id:string}).entity_id));
    return Response.json(rows.slice(start,start+500));
  }}});
  return {db,calls};
}
test('1153 durable reconciliations require only 12 batched audit reads, hide Approved, and never mutate inputs',async()=>{
  const fixtures=Array.from({length:1153},(_,i)=>reconciledFixture(i));
  const drafts=fixtures.map(f=>Object.freeze(f.draft)),before=JSON.stringify(drafts);
  const {db,calls}=eventDatabase(fixtures.map(f=>f.event));
  const output=await projectWorkflowRecovery(db,drafts);
  assert.equal(output.length,1153);assert.equal(calls.length,12);
  assert.ok(output.every(d=>(d as typeof d & {workflow_continuation_context:string}).workflow_continuation_context==='unknown'));
  assert.ok(calls.every(u=>u.pathname.endsWith('/report_writing_audit_events')));
  assert.ok(output.every(d=>!shouldAppearInApproved(d)));
  assert.ok(output.every(d=>(d as typeof d & {workflow_resolved:{status:string}}).workflow_resolved.status==='completed'));
  assert.equal(JSON.stringify(drafts),before);assert.notEqual(output[0],drafts[0]);
  assert.equal(retentionPlan({...output[0],source_text:'synthetic',updated_at:'2026-01-01T00:00:00Z'},retentionSettings({})!),null);
});
for(const defect of ['invalidated','malformed','duplicate','wrong_epoch','lookup_failed','partial_page'])test(`historical first pass fails closed: ${defect}`,async()=>{
  const {draft,event}=reconciledFixture(1);let events:unknown[]=[event];
  if(defect==='invalidated')events.push({...event,id:'invalid',action:'system_historical_reconciliation_invalidated'});
  if(defect==='malformed')event.details.contract='wrong';
  if(defect==='duplicate')events.push({...event,id:'duplicate'});
  if(defect==='wrong_epoch')event.details.epoch='wrong';
  if(defect==='partial_page')events.push(...Array.from({length:499},(_,i)=>({...event,id:`padding-${i}`,action:'unrelated'})));
  const {db,calls}=eventDatabase(events,defect==='lookup_failed'?0:defect==='partial_page'?500:-1);
  const [out]=await projectWorkflowRecovery(db,[draft]);
  assert.ok(shouldAppearInApproved(out));
  assert.ok(calls.some(u=>u.pathname.endsWith('/praktika_helper_jobs')));
  assert.ok(calls.some(u=>u.pathname.endsWith('/mediref_helper_jobs')));
  if(['lookup_failed','partial_page'].includes(defect))assert.equal((out as typeof out & {workflowStatusStale:boolean}).workflowStatusStale,true);
});
test('mixed population sends only modern and unresolved drafts through full recovery, preserving order',async()=>{
  const a=reconciledFixture(1),b=reconciledFixture(2),c=reconciledFixture(3);
  b.draft.workflow_status='running';
  const {db,calls}=eventDatabase([a.event]);
  const input=[b.draft,a.draft,c.draft],before=JSON.stringify(input);
  const output=await projectWorkflowRecovery(db,input);
  assert.deepEqual(output.map(d=>d.id),input.map(d=>d.id));
  assert.deepEqual(output.map(shouldAppearInApproved),[true,false,true]);
  for(const call of calls.filter(u=>!u.pathname.endsWith('/report_writing_audit_events'))){
    const query=decodeURIComponent(call.search);
    assert.ok(!query.includes(a.draft.id));assert.ok(query.includes(b.draft.id));assert.ok(query.includes(c.draft.id));
  }
  assert.equal(JSON.stringify(input),before);
});
test('successful event pagination includes a later invalidation before accepting completion',async()=>{
  const {draft,event}=reconciledFixture(4);
  const events=[event,...Array.from({length:499},(_,i)=>({...event,id:`padding-${i}`,action:'unrelated'})),
    {...event,id:'invalid',action:'system_historical_reconciliation_invalidated'}];
  const {db,calls}=eventDatabase(events);
  const [out]=await projectWorkflowRecovery(db,[draft]);
  assert.ok(shouldAppearInApproved(out));assert.equal(calls.filter(u=>u.pathname.endsWith('/report_writing_audit_events')).length,2);
});

function manualFixture(index: number) {
  const {draft}=reconciledFixture(index);
  draft.workflow_status='failed';
  const job={id:`11111111-1111-4111-8111-${String(index).padStart(12,'0')}`,job_type:'send_mediref_letter',status:'failed',payload:{draftId:draft.id} as Record<string,unknown>};
  const event={id:`manual-${index}`,entity_id:draft.id,action:'manual_historical_mediref_verification',details:{
    eventId:`manual-${index}`,draftId:draft.id,epoch:'2026-01-01T00:00:00.000000Z/unrecorded',
    contract:'manual-historical-mediref-v1',version:1,source:'human_external_verification',integration:'mediref',outcome:'completed',
    verifierUserId:'33333333-3333-4333-8333-333333333333',verifiedAt:'2026-01-02T00:00:00Z',importedAt:'2026-01-02T00:00:00Z',
    failedJobIds:[job.id],fingerprint:'a'.repeat(64),pdfFingerprint:'b'.repeat(64),workbookFingerprint:'c'.repeat(64),manifestFingerprint:'d'.repeat(64),
    historicalCompletedAt:null,otherBranches:{praktika:'completed',icon:'completed',periodontal:'skipped'}}};
  return {draft,event,job};
}
function manualDatabase(events: ReturnType<typeof manualFixture>['event'][], jobs: ReturnType<typeof manualFixture>['job'][], failure='') {
  const calls:URL[]=[],signals=new Set<AbortSignal>();
  const db=createClient('https://fixture.invalid','synthetic',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    assert.equal(init?.method,'GET');if(init?.signal)signals.add(init.signal);
    const u=new URL(String(input));calls.push(u);
    const audit=u.pathname.endsWith('/report_writing_audit_events'),med=u.pathname.endsWith('/mediref_helper_jobs');
    if((audit&&failure==='audit')||(med&&failure==='mediref'))return Response.json({message:'unavailable'},{status:400});
    const filter=u.searchParams.get(audit?'entity_id':u.searchParams.has('id')?'id':'payload->>draftId') || '';
    const rows=audit?events.filter(e=>filter.includes(e.entity_id)):med?jobs.filter(j=>filter.includes(u.searchParams.has('id')?j.id:String(j.payload.draftId))):[];
    return Response.json(rows);
  }}});
  return {db,calls,signals};
}
test('130 manual terminal verifications use two audit and two exact-job reads, hide Approved, preserve order and inputs',async()=>{
  const fixtures=Array.from({length:130},(_,i)=>manualFixture(i));
  for(let i=116;i<130;i++)fixtures[i].event.details.otherBranches.icon='skipped';
  const before=JSON.stringify(fixtures),{db,calls,signals}=manualDatabase(fixtures.map(f=>f.event),fixtures.map(f=>f.job));
  const drafts=fixtures.map(f=>Object.freeze(f.draft));
  const out=await projectWorkflowRecovery(db,drafts);
  assert.equal(calls.length,4);assert.equal(signals.size,1);
  assert.equal(calls.filter(u=>u.pathname.endsWith('/report_writing_audit_events')).length,2);
  const jobReads=calls.filter(u=>u.pathname.endsWith('/mediref_helper_jobs'));
  assert.equal(jobReads.length,2);assert.ok(jobReads.every(u=>u.searchParams.has('id')&&!u.searchParams.has('payload->>draftId')));
  assert.ok(calls.every(u=>u.toString().length<5000));
  assert.deepEqual(out.map(d=>d.id),drafts.map(d=>d.id));assert.ok(out.every(d=>!shouldAppearInApproved(d)));
  assert.ok(out.every(d=>(d as typeof d & {workflow_resolved:{historicalMedirefVerification:unknown}}).workflow_resolved.historicalMedirefVerification));
  assert.equal(JSON.stringify(fixtures),before);
});
for(const defect of ['periodontal','icon','praktika','missing','mismatched','completed','retry','continuation','invalidated','duplicate','system','malformed','wrong_epoch','extra','audit','mediref'])
  test(`manual exact-job fast path falls through safely: ${defect}`,async()=>{
    const {draft,event,job}=manualFixture(1);const events=[event],jobs=[job];
    if(['periodontal','icon','praktika'].includes(defect))event.details.otherBranches[defect as 'periodontal'|'icon'|'praktika']='unknown';
    if(defect==='missing')jobs.length=0;
    if(defect==='mismatched')job.payload.draftId='other';
    if(defect==='completed')job.status='completed';
    if(defect==='retry')job.payload.retryMediref=true;
    if(defect==='continuation')job.payload.workflowContinuationId='parent';
    if(defect==='invalidated')events.push({...event,id:'invalid',action:'manual_historical_mediref_invalidated'});
    if(defect==='duplicate')events.push({...event,id:'duplicate'});
    if(defect==='system')events.push({...event,id:'system',action:'system_historical_reconciliation'});
    if(defect==='malformed')event.details.fingerprint='invalid';
    if(defect==='wrong_epoch')event.details.epoch='changed';
    // A second candidate discloses another job for this same draft; it must not
    // be discarded merely because the first event did not name it.
    if(defect==='extra'){
      const other=manualFixture(2);other.job.payload.draftId=draft.id;
      events.push(other.event);jobs.push(other.job);
    }
    const {db,calls}=manualDatabase(events,jobs,defect);
    const inputs=defect==='extra'?[draft,manualFixture(2).draft]:[draft];
    const [out]=await projectWorkflowRecovery(db,inputs);
    assert.equal(shouldAppearInApproved(out),true);
    assert.ok(calls.some(u=>u.pathname.endsWith('/praktika_helper_jobs')));
    assert.ok(calls.some(u=>u.pathname.endsWith('/mediref_helper_jobs')&&u.searchParams.has('payload->>draftId')));
  });
test('130 terminal and 15 periodontal-unknown records resolve separately without hiding unknown records',async()=>{
  const fixtures=Array.from({length:145},(_,i)=>manualFixture(i));
  for(const f of fixtures.slice(130))f.event.details.otherBranches.periodontal='unknown';
  const {db,calls}=manualDatabase(fixtures.map(f=>f.event),fixtures.map(f=>f.job));
  const out=await projectWorkflowRecovery(db,fixtures.map(f=>f.draft));
  assert.equal(out.filter(shouldAppearInApproved).length,15);
  for(const u of calls.filter(u=>u.pathname.endsWith('/praktika_helper_jobs')||u.searchParams.has('payload->>draftId'))){
    assert.ok(!decodeURIComponent(u.search).includes(fixtures[0].draft.id));
  }
});

for (const scenario of ['canonical','other','absent','failed','partial_page'] as const) {
  test(`continuation presentation context ${scenario}: bounded existing reads and immutable inputs`,async()=>{
    const id='11111111-1111-4111-8111-111111111111';
    const draft={id,status:'approved',workflow_continuation_context:'absent'};
    const before=JSON.stringify(draft);const calls:URL[]=[];
    const db=createClient('https://fixture.invalid','synthetic',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
      assert.equal(init?.method,'GET');const u=new URL(String(input));calls.push(u);
      if(u.searchParams.get('job_type')==='eq.complete_report_workflow'){
        if(scenario==='failed'||(scenario==='partial_page'&&Number(u.searchParams.get('offset'))===500))
          return Response.json({message:'unavailable'},{status:400});
        const parent={id:scenario==='other'?'22222222-2222-4222-8222-222222222222':continuationIntentId(id),
          status:'waiting',job_type:'complete_report_workflow',app_user_id:'actor',request:{reportDraftId:id,actorUserId:'actor'}};
        return Response.json(scenario==='absent'?[]:scenario==='partial_page'?Array.from({length:500},()=>parent):[parent]);
      }
      return Response.json([]);
    }}});
    const [out]=await projectWorkflowRecovery(db,[Object.freeze(draft)]);
    assert.equal(out.workflow_continuation_context,['failed','partial_page'].includes(scenario)?'unknown':scenario==='absent'?'absent':'present');
    assert.equal(calls.length,scenario==='partial_page'?5:4);
    assert.equal(JSON.stringify(draft),before);assert.ok(shouldAppearInApproved(out));
  });
}

for (const scenario of ['credentials','connected','mfa','missing','duplicate','user_mismatch','wrong_child','wrong_link','historical','lookup_failure','other_parent','other_upload','replacement','parent_failure','upload_failure'] as const) {
  test(`connection block ${scenario}: existing reads only and no input mutation`,async()=>{
    const id='11111111-1111-4111-8111-111111111111',parentId=continuationIntentId(id);
    const parent={id:parentId,job_type:'complete_report_workflow',status:'waiting',app_user_id:'actor',request:{reportDraftId:id,actorUserId:'actor'},response:{stage:'upload',...(scenario==='replacement'?{retryUploadId:'replacement'}:{})}};
    const child={id:scenario==='wrong_child'?'wrong':continuationChildId(parentId,'upload_report_to_praktika'),job_type:'upload_report_to_praktika',status:'pending',app_user_id:scenario==='user_mismatch'?'other':'actor',request:{reportDraftId:id,continuationId:scenario==='wrong_link'?'other':parentId},response:null};
    const draft={id,status:'approved',workflow_connection_block:'praktika_credentials_required'};
    const before=JSON.stringify(draft),calls:URL[]=[];
    const db=createClient('https://fixture.invalid','synthetic',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
      assert.equal(init?.method,'GET');const u=new URL(String(input));calls.push(u);
      if(u.searchParams.get('job_type')==='eq.complete_report_workflow') {
        if(scenario==='parent_failure')return Response.json({message:'unavailable'},{status:400});
        return Response.json(scenario==='historical'?[]:scenario==='other_parent'?[parent,{...parent,id:'other'}]:[parent]);
      }
      if(u.pathname.endsWith('/praktika_helper_jobs')) {
        if(scenario==='upload_failure')return Response.json({message:'unavailable'},{status:400});
        if(u.searchParams.has('id'))return Response.json([]);
        return Response.json(scenario==='other_upload'?[child,{...child,id:'other'}]:[child]);
      }
      if(u.pathname.endsWith('/praktika_sessions')) {
        if(scenario==='lookup_failure')return Response.json({message:'unavailable'},{status:400});
        const session={id:'session',app_user_id:'actor',status:scenario==='connected'?'connected':scenario==='mfa'?'waiting_for_mfa':'waiting_for_credentials',helper_instance_id:null,helper_heartbeat_at:null};
        return Response.json(scenario==='missing'?[]:scenario==='duplicate'?[session,{...session,id:'duplicate'}]:[session]);
      }
      return Response.json([]);
    }}});
    const [out]=await projectWorkflowRecovery(db,[Object.freeze(draft)]);
    assert.equal(out.workflow_connection_block,scenario==='credentials'?'praktika_credentials_required':'unknown');
    assert.equal(JSON.stringify(draft),before);assert.ok(shouldAppearInApproved(out));
    assert.equal(calls.filter(u=>u.pathname.endsWith('/praktika_sessions')).length,scenario==='upload_failure'?0:1);
    assert.equal(calls.length,['wrong_child','replacement'].includes(scenario)?6:5);
  });
}
