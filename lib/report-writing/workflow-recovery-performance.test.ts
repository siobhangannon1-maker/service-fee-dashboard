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
