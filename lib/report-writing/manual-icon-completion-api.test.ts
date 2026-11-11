import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync('app/api/report-writing/complete-manual-icon/route.ts','utf8');
const code=ts.transpileModule(source.slice(source.indexOf('async function handle')).replaceAll('export const','const')+'\n({GET,POST})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000001';
class ApiAuthorizationError extends Error {status=403;}
function fixture(options:{denied?:boolean;signed?:boolean;persistError?:boolean;actor?:string}={}) {
 const calls:string[]=[];
 const state={fingerprint:'preview',letterFingerprint:'letter',manualIconReady:true,draft:{patient_name:'PRIVATE_PATIENT'},
 parent:{app_user_id:'synthetic-actor',request:{options:{attachPeriodontalChart:false,private:'PRIVATE_SESSION'}}},mediref:[{result:{prepared:true,sent:false}}]};
 const handlers=runInNewContext(code,{Request,Response,URL,AbortSignal,NextResponse:Response,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'}},
 ApiAuthorizationError,requireActiveApiUser:async()=>{if(options.denied)throw new ApiAuthorizationError();return {user:{id:'synthetic-actor'}};},
 openResolutionPreview:()=>({actorId:options.actor||'synthetic-actor',draftId:id,fingerprint:'preview',letterFingerprint:'letter'}),sealResolutionPreview:()=> 'opaque',
 validWorkflowAuthorization:()=>options.signed!==false,
 db:{rpc:(name:string)=>{calls.push(name);return {abortSignal:async()=>name==='inspect_manual_letter_icon'?{data:state}:options.persistError?{error:{message:'PRIVATE_ERROR'}}:{data:{ok:true}}};}},
 }) as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>};
 return {calls,state,get:()=>handlers.GET(new Request('http://localhost/api/report-writing/complete-manual-icon?draftId='+id)),
 post:(extra:Record<string,unknown>={})=>handlers.POST(new Request('http://localhost/api/report-writing/complete-manual-icon',{method:'POST',body:JSON.stringify({draftId:id,preview:'opaque',iconConfirmed:true,...extra})}))};
}
test('manual completion API dispatches only its two administrative RPCs',async()=>{
 const f=fixture();assert.equal((await f.post()).status,200);assert.deepEqual(f.calls,['inspect_manual_letter_icon','confirm_manual_letter_icon']);
});
test('preview exposes only sanitised status and an opaque token',async()=>{
 const f=fixture(),r=await f.get();assert.equal(r.status,200);const text=await r.text();assert.doesNotMatch(text,/PRIVATE/);assert.match(text,/prepared/);assert.deepEqual(f.calls,['inspect_manual_letter_icon']);
});
for(const value of [false,null,undefined,'true'])test(`strict manual confirmation rejects ${String(value)}`,async()=>{
 const f=fixture();assert.equal((await f.post({iconConfirmed:value})).status,400);assert.deepEqual(f.calls,[]);
});
test('permissions and preview ownership reject before database work',async()=>{
 for(const options of [{denied:true},{actor:'other-actor'}]) {const f=fixture(options);assert.notEqual((await f.post()).status,200);assert.deepEqual(f.calls,[]);}
});
test('unsigned parent cannot reach confirmation',async()=>{
 const f=fixture({signed:false});assert.equal((await f.post()).status,503);assert.deepEqual(f.calls,['inspect_manual_letter_icon']);
});
test('persistence uncertainty returns a generic error and never retries',async()=>{
 const f=fixture({persistError:true}),r=await f.post();assert.equal(r.status,409);assert.doesNotMatch(await r.text(),/PRIVATE/);assert.deepEqual(f.calls,['inspect_manual_letter_icon','confirm_manual_letter_icon']);
});
