import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertMedirefNotAcknowledged, hasMedirefAcknowledgement, MedirefAcknowledgementError } from './manual-acknowledgement';
import { safePreInsertionFailure } from './pre-insertion-failure';
import { createEnqueueDiagnostics } from './enqueue-transition';
import { manualVerificationReason } from '../report-writing/manual-verification-reasons';
const id='11111111-1111-4111-8111-111111111111';
const marker={manualVerification:{mediref:{source:'manually_sent',recoveryClass:'no_prior_helper_job_v1'}}};
function declaration(path:string,name:string) {
 const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;
 return ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
function fakeDb(response:unknown=marker,error:unknown=null) {
 let inserts=0,updates=0;
 const db={from(table:string) {
  const q:any={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,abortSignal:()=>q,lte:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>({data:{response},error}),single:async()=>({data:{id,status:'approved'},error:null}),
   insert:()=>{inserts++;return q;},update:()=>{updates++;return q;},
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='mediref_helper_jobs'?[{id,job_type:'send_mediref_letter',payload:{draftId:id}}]:[],error:null}).then(resolve)};
  return q;
 }};
 return {db,inserts:()=>inserts,updates:()=>updates};
}
test('acknowledgement helper blocks and fails closed on lookup failure',async()=>{
 const f=fakeDb();await assert.rejects(assertMedirefNotAcknowledged(f.db as any,id),MedirefAcknowledgementError);
 await assert.rejects(assertMedirefNotAcknowledged(fakeDb(null,{message:'SECRET'}).db as any,id),/eligibility could not be checked/);
 await assertMedirefNotAcknowledged(fakeDb(null).db as any,id);assert.equal(hasMedirefAcknowledgement({}),false);
});
test('ordinary Send via MediRef is fenced before PDF generation/storage/queue/network',async()=>{
 const f=fakeDb();const post=runInNewContext(declaration('app/api/report-writing/send-via-mediref/route.ts','POST')+'\nPOST',{
  currentWorkflowExecution:()=>null,sensitiveApiAccess:async()=>null,nowMs:()=>0,createEnqueueDiagnostics,
  getAuditActor:async()=>({actorUserId:id}),getUserStatus:async()=>true,normaliseAdditionalRecipients:()=>[],
  supabase:f.db,logStep:()=>{},assertMedirefNotAcknowledged,MedirefAcknowledgementError,
  NextResponse:{json:Response.json},generateLetterPdf:()=>assert.fail('no PDF'),fetch:()=>assert.fail('no external call'),
 });
 const r=await post(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:id})}));
 assert.equal(r.status,409);assert.equal((await r.json()).code,'manually_acknowledged');assert.equal(f.inserts(),0);assert.equal(f.updates(),0);
});
test('helper enqueue checks marker before any insertion',async()=>{
 const f=fakeDb();const create=runInNewContext(declaration('lib/mediref/helper-jobs.ts','createMedirefHelperJob')+'\ncreateMedirefHelperJob',{supabaseAdmin:f.db,assertMedirefNotAcknowledged});
 await assert.rejects(create({jobType:'send_mediref_letter',request:{draftId:id}}),MedirefAcknowledgementError);assert.equal(f.inserts(),0);
});
test('retry checks fence before preparing or claiming; controlled failure returned',async()=>{
 const path='app/api/report-writing/retry-mediref/route.ts';const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const storeNode=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='store'))!;
 const code=ts.transpileModule(storeNode.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const f=fakeDb();const store=runInNewContext(code+'\nstore',{db:f.db,assertMedirefNotAcknowledged});
 await assert.rejects(store.draft(id),MedirefAcknowledgementError);assert.equal(f.updates(),0);
 const handle=runInNewContext(declaration(path,'handle')+'\nhandle',{sensitiveApiAccess:async()=>null,getAuditActor:async()=>({actorUserId:id}),getUserStatus:async()=>true,
  store,bucket:'synthetic',queueRetry:async()=>store.draft(id),prepareRetry:async()=>store.draft(id),NextResponse:{json:Response.json},MedirefAcknowledgementError,URL});
 const r=await handle(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:id})}),true);
 assert.equal(r.status,409);assert.equal((await r.json()).code,'manually_acknowledged');
});
test('pending worker preflight fences before MediRef session validation or any external call',async()=>{
 const path='scripts/refresh-mediref-session.ts';const f=fakeDb();
 const code=['pendingMedirefExecutionAllowed','processOnePendingMedirefJob'].map(n=>declaration(path,n)).join('\n');
 const run=runInNewContext(code+'\nprocessOnePendingMedirefJob',{supabase:f.db,assertMedirefNotAcknowledged,nowIso:()=>new Date().toISOString(),
  isBrowserUiLoggedIn:()=>assert.fail('no session interaction'),validateSessionCookie:()=>assert.fail('no network'),claimNextPendingMedirefJob:()=>assert.fail('no claim')});
 assert.equal(await run({},{}),false);assert.equal(f.updates(),0);
});
test('worker claim checks fence before pending-to-processing update',async()=>{
 const f=fakeDb();const claim=runInNewContext(declaration('scripts/refresh-mediref-session.ts','claimNextPendingMedirefJob')+'\nclaimNextPendingMedirefJob',{
  supabase:f.db,assertMedirefNotAcknowledged,lifecycle:{stopping:false,write:async()=>{}},nowIso:()=>new Date().toISOString()});
 assert.equal(await claim(),null);assert.equal(f.updates(),0);
});
test('worker execution rechecks fence before downloads and browser action',async()=>{
 const f=fakeDb();const run=runInNewContext(declaration('scripts/refresh-mediref-session.ts','processOnePendingMedirefJob')+'\nprocessOnePendingMedirefJob',{
  pendingMedirefExecutionAllowed:async()=>true,isBrowserUiLoggedIn:async()=>true,validateSessionCookie:async()=>true,
  claimNextPendingMedirefJob:async()=>({id,job_type:'send_mediref_letter',payload:{draftId:id}}),supabase:f.db,assertMedirefNotAcknowledged,MedirefAcknowledgementError,
  console:{log(){},error(){}},downloadStagedAttachments:()=>assert.fail('no download'),sendMedirefLetterWithBrowser:()=>assert.fail('no external send'),failMedirefJob:()=>assert.fail('do not overwrite acknowledgement')});
 assert.equal(await run({},{}),true);
});
test('no-job API uses only verification RPC, expected token and server actor',async()=>{
 let calls=0;const code=declaration('app/api/report-writing/verify-workflow-completion/route.ts','handle');
 const run=runInNewContext(code+'\nhandle',{requireActiveApiUser:async()=>({user:{id:'server-actor'}}),URL,AbortSignal,NextResponse:{json:Response.json},
  manualVerificationReason,supabaseAdmin:{rpc:(name:string,args:any)=>{calls++;assert.equal(name,'verify_workflow_completion');assert.equal(args.p_prior_job_id,null);assert.equal(args.p_expected_state,'a'.repeat(64));assert.equal(args.p_actor_user_id,'server-actor');return{abortSignal:async()=>({data:{ok:true},error:null})};}},fetch:()=>assert.fail('no external call')});
 const r=await run(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:id,integration:'mediref',priorJobId:null,recoveryClass:'no_prior_helper_job_v1',currentStateToken:'a'.repeat(64),verifiedSuccess:true})}),true);
 assert.equal(r.status,200);assert.equal(calls,1);
});
for(const reason of ['active_work','uncertain_execution','missing_safe_evidence','state_changed','historical_review_required'])test(`API exposes controlled blocking reason ${reason}`,async()=>{
 const handle=runInNewContext(declaration('app/api/report-writing/verify-workflow-completion/route.ts','handle')+'\nhandle',{requireActiveApiUser:async()=>({user:{id}}),URL,AbortSignal,NextResponse:{json:Response.json},manualVerificationReason,
  supabaseAdmin:{rpc:()=>({abortSignal:async()=>({data:{ok:false,code:reason},error:null})})}});
 const r=await handle(new Request(`https://fixture.invalid?draftId=${id}&integration=mediref`),false);const result=await r.json();
 assert.equal(r.status,200);assert.equal(result.code,reason);assert.equal(result.error,manualVerificationReason(reason));assert.doesNotMatch(JSON.stringify(result),new RegExp(id));
 if(reason==='missing_safe_evidence')assert.doesNotMatch(result.error,/check again/i);
});
for(const stage of ['patient_validation','pdf_generation','pdf_validation','storage_upload','storage_verification','attachment_validation'])test(`structured ${stage} proof is non-sensitive and requires no insertion/deadline`,()=>{
 const value={stage,code:`MEDIREF_${stage.toUpperCase()}_FAILED`,deadlineExceeded:false,insertionOutcome:'not_attempted',error:'SECRET LETTER'};
 const proof=safePreInsertionFailure(value);assert.ok(proof);assert.doesNotMatch(JSON.stringify(proof),/SECRET/);
 assert.equal(safePreInsertionFailure({...value,deadlineExceeded:true}),null);assert.equal(safePreInsertionFailure({...value,insertionOutcome:'unconfirmed'}),null);
});
