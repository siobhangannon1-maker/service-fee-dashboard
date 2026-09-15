import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { manualVerification } from './manual-verification';
import { projectWorkflowRecovery } from './workflow-recovery';
import { continuationIntentId } from './workflow-continuation-token';
import { remainsInApproved } from './praktika-retry';
const path='app/api/report-writing/verify-workflow-completion/route.ts';
const source=readFileSync(path,'utf8');
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handle')!;
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
class AuthError extends Error { constructor(public status:number){super('PRIVATE');} }
const id='11111111-1111-4111-8111-111111111111';
for(const role of ['admin','super_admin','practice_manager','typist','staff','billing_staff','provider_readonly','inactive','anon','invalid']) test('manual verification authorization '+role,async()=>{
 let calls=0;
 const handle=runInNewContext(code+'\nhandle',{ApiAuthorizationError:AuthError,NextResponse:{json:Response.json},URL,AbortSignal,
  requireActiveApiUser:async(roles:string[])=>{if(!roles.includes(role))throw new AuthError(['anon','invalid'].includes(role)?401:403);return{user:{id:'server-actor'}};},
  supabaseAdmin:{rpc:(name:string,args:Record<string,unknown>)=>{calls++;assert.equal(name,'verify_workflow_completion');assert.equal(args.p_actor_user_id,'server-actor');assert.equal(args.p_verified_success,true);return{abortSignal:async()=>({data:{ok:true},error:null})};}}
 });
 const r=await handle(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:id,priorJobId:id,integration:'praktika',verifiedSuccess:true,actorId:'forged'})}),true);
 const allowed=['admin','super_admin','practice_manager','typist'].includes(role);
 assert.equal(r.status,allowed?200:['anon','invalid'].includes(role)?401:403);assert.equal(calls,allowed?1:0);
 assert.doesNotMatch(await r.text(),/PRIVATE|forged/);
});
test('confirmation required; handler has no external/enqueue dependency',async()=>{
 const handle=runInNewContext(code+'\nhandle',{NextResponse:{json:Response.json},URL,AbortSignal,requireActiveApiUser:async()=>({user:{id}}),supabaseAdmin:{rpc:()=>assert.fail('no RPC without confirmation')}});
 const r=await handle(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:id,priorJobId:id,integration:'mediref'})}),true);assert.equal(r.status,400);
 assert.doesNotMatch(source,/fetch\(|create.*Job|send-via|upload-to|playwright/);
});
test('projection respects manual verification and leaves another unresolved branch in Approved',async()=>{
 const intentId=continuationIntentId(id);
 const audit={integration:'praktika',action:'manually_verified_completed',actorUserId:id,verifiedAt:new Date().toISOString(),priorJobId:id,attempt:1,draftId:id,intentId,verifiedSuccess:true};
 const response={stage:'upload',manualVerification:{praktika:audit}};
 const db={from:()=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,abortSignal:()=>q,then:(resolve:any)=>Promise.resolve({data:[{id:intentId,status:'failed',response}]}).then(resolve)};return q;}};
 const [draft]=await projectWorkflowRecovery(db as any,[{id,status:'approved',workflow_status:'failed',workflow_error:'MediRef needs verification.',workflow_praktika_upload_status:'failed',workflow_mediref_status:'failed',workflow_icon_update_status:'completed'}]);
 assert.equal(draft.workflow_praktika_upload_status,'completed');assert.equal(draft.workflow_error,'MediRef needs verification.');assert.equal(remainsInApproved(draft),true);
 assert.equal(remainsInApproved({...draft,workflow_mediref_status:'completed',workflow_status:'completed'}),true);
 assert.equal(manualVerification(response,'praktika','other',intentId),null);
 assert.equal(manualVerification(response,'mediref',id,intentId),null);
});
test('confirmation UI has explicit opposite meanings; Cancel has no network operation',()=>{
 const ui=readFileSync('components/report-writing/ManualVerificationButton.tsx','utf8');
 assert.match(ui,/if \(!confirming \|\| !priorJobId \|\| submitting.current\) return/);
 assert.match(ui,/onClick=\{\(\) => setConfirming\(false\)\}>Cancel/);
 assert.match(ui,/Nothing will be uploaded again/);assert.match(ui,/Nothing will be sent again/);
 assert.match(ui,/verifiedSuccess: true/);
});

test('unresolved required periodontal branch remains in Approved after integration verification',()=>{
 assert.equal(remainsInApproved({status:'approved',workflow_status:'failed',workflow_praktika_upload_status:'completed',workflow_mediref_status:'completed',workflow_icon_update_status:'completed',workflow_periodontal_chart_status:'failed'}),true);
});
