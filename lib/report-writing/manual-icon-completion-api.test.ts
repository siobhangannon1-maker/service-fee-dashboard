import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync('app/api/report-writing/complete-manual-workflow/route.ts','utf8');
const code=ts.transpileModule(source.slice(source.indexOf('async function handle')).replaceAll('export const','const')+'\n({GET,POST})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000001';
class ApiAuthorizationError extends Error {constructor(public status=403){super();}}
function fixture(options:{denied?:boolean;rpcCode?:string;blocked?:boolean;actor?:string;persistError?:boolean;notStarted?:boolean}={}){
 const calls:string[]=[],logs:unknown[]=[];const state={fingerprint:'preview',letterFingerprint:'letter',eligible:!options.blocked&&!options.notStarted,reasonCode:options.notStarted?'workflow_not_started':options.blocked?'active_job':null,private:'PRIVATE_PATIENT PRIVATE_TOKEN'};
 const handlers=runInNewContext(code,{Request,Response,URL,AbortSignal,NextResponse:Response,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'}},console:{warn:(...args:unknown[])=>logs.push(args)},
 ApiAuthorizationError,requireActiveApiUser:async(roles:string[])=>{assert.deepEqual(Array.from(roles),['typist','practice_manager','admin','super_admin']);if(options.denied)throw new ApiAuthorizationError();return {user:{id:'synthetic-actor'}};},
 openResolutionPreview:()=>({actorId:options.actor||'synthetic-actor',draftId:id,fingerprint:'preview',letterFingerprint:'letter'}),sealResolutionPreview:()=> 'opaque',
 db:{rpc:(name:string)=>{calls.push(name);return {abortSignal:async()=>name==='inspect_manual_workflow_completion'?(options.rpcCode?{error:{code:options.rpcCode,message:'PRIVATE_ERROR'}}:{data:state}):options.persistError?{error:{message:'PRIVATE_ERROR'}}:{data:{ok:true}}};}},
 }) as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>};
 return {calls,logs,get:()=>handlers.GET(new Request('http://localhost/api/report-writing/complete-manual-workflow?draftId='+id)),post:(extra:Record<string,unknown>={})=>handlers.POST(new Request('http://localhost/api/report-writing/complete-manual-workflow',{method:'POST',body:JSON.stringify({draftId:id,preview:'opaque',allStepsConfirmed:true,...extra})}))};
}
test('administrative POST invokes only one locked administrative RPC, never workflow actions',async()=>{
 const f=fixture();assert.equal((await f.post()).status,200);assert.deepEqual(f.calls,['confirm_manual_workflow_completion']);
});
test('preview needs no previous automation success or parent signing contract',async()=>{
 const f=fixture(),r=await f.get();assert.equal(r.status,200);const text=await r.text();assert.doesNotMatch(text,/PRIVATE/);assert.match(text,/opaque/);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(f.calls,['inspect_manual_workflow_completion']);
});
for(const value of [false,null,undefined,'true'])test(`strict all-steps confirmation rejects ${String(value)}`,async()=>{
 const f=fixture();assert.equal((await f.post({allStepsConfirmed:value,iconConfirmed:true})).status,400);assert.deepEqual(f.calls,[]);
});
test('permissions and token ownership reject before database work',async()=>{
 for(const options of [{denied:true},{actor:'another-user'}]){const f=fixture(options);assert.notEqual((await f.post()).status,200);assert.deepEqual(f.calls,[]);}
});
for(const rpcCode of ['57014','42501','unknown'])test(`safe administrative preview failure ${rpcCode}`,async()=>{
 const f=fixture({rpcCode}),r=await f.get(),body=await r.json();assert.equal(r.status,503);assert.equal(body.code,rpcCode==='57014'?'manual_workflow_check_timeout':'manual_workflow_check_unavailable');assert.doesNotMatch(JSON.stringify([body,f.logs]),/PRIVATE/);assert.deepEqual(f.calls,['inspect_manual_workflow_completion']);
});
test('active external work blocks confirmation without requiring successful automation',async()=>{
 const f=fixture({blocked:true}),r=await f.get(),body=await r.json();assert.equal(r.status,200);assert.equal(body.eligible,false);assert.match(body.reason,/active/);assert.doesNotMatch(body.reason,/PDF|chart|MediRef/);
});
test('persistence uncertainty never retries or exposes internal errors',async()=>{
 const f=fixture({persistError:true}),r=await f.post();assert.equal(r.status,409);assert.doesNotMatch(await r.text(),/PRIVATE/);assert.deepEqual(f.calls,['confirm_manual_workflow_completion']);
});
test('cached icon-only clients must refresh and cannot submit an old attestation',async()=>{
 const old=readFileSync('app/api/report-writing/complete-manual-icon/route.ts','utf8');assert.doesNotMatch(old,/\.rpc\(/);
 const oldCode=ts.transpileModule(old.slice(old.indexOf('async function retired')).replaceAll('export const','const')+'\n({GET,POST})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const h=runInNewContext(oldCode,{NextResponse:Response,requireActiveApiUser:async()=>({}),ApiAuthorizationError}) as {POST:()=>Promise<Response>};assert.equal((await h.POST()).status,409);
});

test('never-started administrative preview is blocked with a specific safe reason',async()=>{
 const f=fixture({notStarted:true}),r=await f.get(),body=await r.json();assert.equal(r.status,200);assert.equal(body.eligible,false);assert.match(body.reason,/No workflow has started/);assert.deepEqual(f.calls,['inspect_manual_workflow_completion']);
});
