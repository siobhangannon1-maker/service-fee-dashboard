import {test} from 'node:test';
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
 const context={exports,Response,URL,AbortSignal,require:(name:string)=>{assert.equal(name,'@/lib/auth');return authExports;}};
 runInNewContext(compile(source)+'\nexports.reviewInputs=reviews;',context);
 return {calls,post:exports.POST as (req:Request)=>Promise<Response>,reviews:JSON.parse(JSON.stringify(exports.reviewInputs)) as Record<string,unknown>[]};
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
