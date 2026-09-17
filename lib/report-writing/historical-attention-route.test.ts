import {test} from 'node:test';
import {createHash,webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync('app/api/report-writing/historical-attention/route.ts','utf8');
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(role='admin',state='active',result={ok:true,code:'dispositioned'},rpcError=false){
 const calls: {name:string;args:Record<string,unknown>}[]=[];
 const session={auth:{getUser:async()=>({data:{user:state==='anonymous'?null:{id:'session-actor'}},error:state==='expired'?new Error('PRIVATE'):null})},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role},error:null})})})}),
  rpc:(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {abortSignal:async()=>({data:result,error:rpcError?new Error('PRIVATE'):null})};}};
 const authExports:Record<string,unknown>={};
 runInNewContext(compile(readFileSync('lib/auth.ts','utf8')),{exports:authExports,require:(name:string)=>{
  if(name==='@/lib/supabase/server')return {createClient:async()=>session};
  if(name==='@/lib/getUserStatus')return {getUserStatus:async()=>state!=='inactive'};
  if(name==='next/navigation')return {redirect:()=>{throw new Error('unexpected redirect');}};
  throw new Error(name);
 }});
 const exports:Record<string,unknown>={};
 const cohortExports:Record<string,unknown>={};
 runInNewContext(compile(readFileSync('lib/report-writing/historical-attention-cohort.ts','utf8')),{
  exports:cohortExports,require:(name:string)=>{
   if(name==='server-only')return {};
   if(name==='node:crypto')return {createHash};
   if(name==='./historical-attention-cohort.json')return {default:JSON.parse(readFileSync('lib/report-writing/historical-attention-cohort.json','utf8'))};
   throw new Error(name);
  }
 });
 const context={exports,Response,URL,AbortSignal,require:(name:string)=>{
  if(name==='@/lib/report-writing/historical-attention-cohort')return cohortExports;
  assert.equal(name,'@/lib/auth');return authExports;
 }};
 runInNewContext(compile(source)+'\nexports.reviewInputs=reviews;',context);
 return {calls,get:exports.GET as (req:Request)=>Promise<Response>,cohort:JSON.parse(readFileSync('lib/report-writing/historical-attention-cohort.json','utf8')),digest:cohortExports.approvedAttentionDigest as string,post:exports.POST as (req:Request)=>Promise<Response>,reviews:JSON.parse(JSON.stringify(exports.reviewInputs)) as Record<string,unknown>[]};
}
const request=(body:unknown,origin='https://app.example')=>new Request('https://app.example/api/report-writing/historical-attention',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
for(const [role,state,status] of [['admin','anonymous',401],['admin','expired',401],['admin','inactive',403],['typist','active',403],['practice_manager','active',403],['billing_staff','active',403]] as const)test(`${state} ${role} denied before RPC`,async()=>{
 const f=fixture(role,state);assert.equal((await f.post(request({...f.reviews[0],execute:true}))).status,status);assert.equal(f.calls.length,0);
});
for(const role of ['admin','super_admin'])test(`${role} uses the verified session client for all three reviewed records`,async()=>{
 const f=fixture(role);
 for(const review of f.reviews){const res=await f.post(request({...review,execute:true}));assert.equal(res.status,200);assert.equal((await res.json()).result,'dispositioned');}
 assert.equal(f.calls.length,3);
 for(const call of f.calls){assert.equal(call.name,'disposition_historical_attention');assert.equal(call.args.p_execute,true);assert.equal(call.args.p_operator_confirmed,false);assert.ok(!Object.keys(call.args).some(k=>/actor|user/.test(k)));}
});
for(const field of ['draftId','epoch','revision','fingerprint','uploadJobId','artifactFingerprint','manifestDigest','branches','policyVersion','reason','evidenceKind','actorId'])test(`wrong ${field} cannot invoke RPC`,async()=>{
 const f=fixture();assert.equal((await f.post(request({...f.reviews[0],[field]:'unreviewed',execute:true}))).status,400);assert.equal(f.calls.length,0);
});
test('cross-origin denied and arrays cannot enable bulk execution',async()=>{
 const f=fixture();assert.equal((await f.post(request({...f.reviews[0],execute:true},'https://other.example'))).status,403);
 assert.equal((await f.post(request(f.reviews))).status,400);assert.equal(f.calls.length,0);
});
for(const code of ['state_changed','active_work','artifact_or_patient_mismatch','forbidden'])test(`RPC remains authoritative: ${code}`,async()=>{
 const f=fixture('admin','active',{ok:false,code});const res=await f.post(request({...f.reviews[0],execute:true}));assert.equal(res.status,code==='forbidden'?403:409);assert.equal(f.calls.length,1);
});
test('dry run stays nonexecuting; idempotent acknowledgement supported',async()=>{
 const f=fixture('admin','active',{ok:true,code:'eligible'});assert.equal((await f.post(request({...f.reviews[0],execute:false}))).status,200);assert.equal(f.calls[0].args.p_execute,false);
 const g=fixture('admin','active',{ok:true,code:'already_dispositioned'});assert.equal((await (await g.post(request({...g.reviews[0],execute:true}))).json()).result,'already_dispositioned');
});
test('ambiguous acknowledgement is safe and never retried automatically',async()=>{
 const f=fixture('admin','active',undefined,true);const res=await f.post(request({...f.reviews[0],execute:true}));assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/PRIVATE/);assert.equal(f.calls.length,1);
});
test('route can only call disposition RPC: no privileged execution, branch mutations, retention or polling',()=>{
 assert.doesNotMatch(source,/supabaseAdmin|SERVICE_ROLE|setInterval|setTimeout|\.from\(|\.insert\(|\.update\(|\.delete\(|fetch\(/);
 assert.equal((source.match(/\.rpc\(/g)||[]).length,1);
 assert.match(source,/identity\.supabase\.rpc\('disposition_historical_attention'/);
 assert.doesNotMatch(source,/p_actor|authorizingActorId|executionUserId/);
});

test('server verified cohort is authenticated, hash bound and not cached',async()=>{
 const f=fixture();const res=await f.get(new Request('https://app.example/api/report-writing/historical-attention?cohortDigest='+f.digest));
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
 const value=await res.json();assert.equal(createHash('sha256').update(JSON.stringify(value.cohort)).digest('hex'),f.digest);
 assert.equal(value.cohort.records.length,61);assert.equal(f.calls.length,0);
 const denied=fixture('typist');assert.equal((await denied.get(new Request('https://app.example/?cohortDigest='+f.digest))).status,403);
});
for(const field of ['draftId','cohortDigest','revision','fingerprint','epoch','artifactFingerprint','evidenceKind','providerId'])test(`frozen cohort rejects altered ${field}`,async()=>{
 const f=fixture();const body={...f.cohort.records[0],cohortDigest:f.digest,execute:true,[field]:'arbitrary'};
 assert.equal((await f.post(request(body))).status,400);assert.equal(f.calls.length,0);
});
test('exact cohort entry passes only to authenticated RPC; inspector rejection and drift stop',async()=>{
 for(const code of ['not_historical','state_changed','active_work']){
  const f=fixture('admin','active',{ok:false,code});assert.equal((await f.post(request({...f.cohort.records[0],cohortDigest:f.digest,execute:false}))).status,409);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_execute,false);
 }
 const f=fixture();assert.equal((await f.post(request({...f.cohort.records[0],cohortDigest:f.digest,execute:true}))).status,200);
 assert.equal(f.calls[0].args.p_manifest_digest,f.digest);assert.equal(f.calls[0].args.p_evidence_kind,'confirmed_upload');
 assert.equal(f.calls[0].args.p_operator_confirmed,false);
});
async function controller(failure?:string){
 const f=fixture(),memory=new Map<string,string>();let active=0,maxActive=0,posts=0,writes=0;
 const promise=runInNewContext(readFileSync('scripts/historical-attention-browser-controller.js','utf8'),{
  navigator:{locks:{request:async(_key:string,_options:unknown,fn:(lock:object)=>Promise<unknown>)=>fn({})}},
  localStorage:{getItem:(k:string)=>memory.get(k),setItem:(k:string,v:string)=>memory.set(k,v)},
  crypto:webcrypto,TextEncoder,AbortSignal,console:{log(){},error(){}},
  fetch:async(_url:string,options:RequestInit)=>{
   active++;maxActive=Math.max(maxActive,active);await Promise.resolve();
   try{
    if(options.method!=='POST')return Response.json({success:true,cohortDigest:f.digest,cohort:f.cohort});
    posts++;const b=JSON.parse(String(options.body));
    if(b.execute)writes++;
    if(failure==='timeout'&&b.execute)throw Error('private timeout');
    if(failure==='inspector'&&!b.execute)return Response.json({success:false},{status:409});
    if(failure==='state_changed'&&b.execute)return Response.json({success:false},{status:409});
    return Response.json({success:true,draftId:b.draftId,result:failure==='already'?'already_dispositioned':b.execute?'dispositioned':'eligible'});
   }finally{active--;}
  }
 });
 await promise;return {posts,writes,maxActive,journal:JSON.parse([...memory.values()][0])};
}
test('controller is sequential with at most ten records per batch and positive confirmation',async()=>{
 const r=await controller();assert.equal(r.maxActive,1);assert.equal(r.writes,61);assert.equal(r.posts,122);assert.equal(r.journal.status,'completed');
 const batches=new Map<number,number>();for(const entry of r.journal.entries)batches.set(entry.batch,(batches.get(entry.batch)||0)+1);
 assert.ok([...batches.values()].every(n=>n<=10));assert.equal(batches.size,7);
});
for(const reason of ['timeout','inspector','state_changed'])test(`controller stops on ${reason} without later writes or retry`,async()=>{
 const r=await controller(reason);assert.equal(r.journal.status,'STOPPED');assert.equal(r.journal.entries.length,1);assert.equal(r.writes,reason==='inspector'?0:1);assert.equal(r.posts,reason==='inspector'?1:2);
});
test('already dispositioned skips mutation; controller has no polling or external requests',async()=>{
 const r=await controller('already');assert.equal(r.writes,0);assert.equal(r.posts,61);assert.equal(r.journal.status,'completed');
 const s=readFileSync('scripts/historical-attention-browser-controller.js','utf8');assert.doesNotMatch(s,/setInterval|setTimeout|https:\/\//);assert.match(s,/if \(localStorage.getItem\(key\)\)/);
});

test('server refuses artifact tampering instead of accepting a replacement cohort',()=>{
 const frozen=JSON.parse(readFileSync('lib/report-writing/historical-attention-cohort.json','utf8'));
 frozen.records[0].fingerprint='0'.repeat(64);
 const exports:Record<string,unknown>={};
 runInNewContext(compile(readFileSync('lib/report-writing/historical-attention-cohort.ts','utf8')),{
  exports,require:(name:string)=>name==='server-only'?{}:name==='node:crypto'?{createHash}:{default:frozen}
 });
 assert.throws(()=> (exports.approvedAttentionCohort as ()=>unknown)(),/Frozen cohort unavailable/);
});
for(const competing of [false,true])test(`controller refuses ${competing?'competing tab':'existing journal'} without requests`,async()=>{
 let requests=0;
 const run=runInNewContext(readFileSync('scripts/historical-attention-browser-controller.js','utf8'),{
  navigator:{locks:{request:async(_key:string,_opts:unknown,fn:(lock:object|null)=>unknown)=>fn(competing?null:{})}},
  localStorage:{getItem:()=>competing?null:'existing journal'},fetch:()=>{requests++;throw Error();}
 });
 await assert.rejects(run,/STOP/);assert.equal(requests,0);
});
