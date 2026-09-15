import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function declaration(path:string,name:string){
  const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;
  return ts.transpileModule(fn.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const pollCode=declaration('scripts/praktika-workflow-continuations.ts','pollPraktikaWorkflowContinuations');
for(const manual of [false,true]) for(const actor of ['original','retry']) test(`poll routing manual=${manual}, helper=${actor}`,async()=>{
  let posts=0,claims=0;const filters:string[]=[];
  const intent={id:'intent',app_user_id:'original',status:'waiting',updated_at:'fixture',response:{stage:'upload',...(manual?{retryUploadId:'replacement',retryExecutionUserId:'retry'}:{})}};
  const q:any={select:()=>q,eq:()=>q,or:(s:string)=>{filters.push(s);return q;},order:()=>q,limit:()=>q,abortSignal:async()=>({data:[intent]}),update:()=>{claims++;return q;},maybeSingle:async()=>({data:{id:'intent'}})};
  const poll=runInNewContext(pollCode+'\npollPraktikaWorkflowContinuations',{
    workflowConfigurationIssue:()=>null,workflowAppOrigin:()=> 'https://fixture.invalid',inFlight:new Set(),Date,AbortSignal,randomUUID:()=> 'lock',continuationToken:()=> 'synthetic',process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic'}},fetch:async()=>{posts++;return Response.json({success:true});},
  });
  await poll({from:()=>q},actor,{assertOwned:async()=>{},isShuttingDown:()=>false});
  const expected=actor===(manual?'retry':'original')?1:0;
  assert.equal(posts,expected);assert.equal(claims,expected);
  assert.equal(filters.length,1);assert.ok(filters[0].includes(`and(app_user_id.eq.${actor},response->>retryUploadId.is.null,or(`));
  assert.ok(filters[0].includes(`and(response->>retryUploadId.not.is.null,response->>retryExecutionUserId.eq.${actor},or(`));
});

test('reserved replacement activation and new icon insertion retain retry execution actor; worker claims only its own upload',async()=>{
  const rows:any[]=[{id:'replacement',app_user_id:'retry',job_type:'upload_report_to_praktika',status:'waiting',attempts:0,request:{continuationId:'intent',manualRetry:{verifiedAbsent:true,actorUserId:'retry',priorJobId:'old'}}}];
  const db={from:()=>{
    const filters:Array<(r:any)=>boolean>=[];let patch:any;
    const value=(r:any,k:string)=>k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k];
    const execute=(single=false)=>{const matches=rows.filter(r=>filters.every(f=>f(r)));if(patch)matches.forEach(r=>Object.assign(r,patch));return{data:single?matches[0]||null:matches,error:null};};
    const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>value(r,k)===v);return q;},neq:(k:string,v:unknown)=>{filters.push(r=>value(r,k)!==v);return q;},is:(k:string,v:unknown)=>{filters.push(r=>value(r,k)===v);return q;},in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(value(r,k)));return q;},lte:()=>q,order:()=>q,limit:()=>q,
      update:(p:any)=>{patch=p;return q;},insert:(r:any)=>{rows.push(r);filters.push(x=>x===r);return q;},single:async()=>execute(true),maybeSingle:async()=>execute(true),then:(resolve:any)=>Promise.resolve(execute()).then(resolve)};return q;
  }};
  const create=runInNewContext(declaration('lib/praktika/helper-jobs.ts','createPraktikaHelperJob')+'\ncreatePraktikaHelperJob',{
    supabaseAdmin:db,currentWorkflowExecution:()=>({intentId:'intent',retryUploadId:'replacement',actor:{actorUserId:'retry'}}),continuationChildId:()=> 'icon',Date,
  });
  await create({appUserId:'retry',jobType:'upload_report_to_praktika',request:{reportDraftId:'draft'}});
  assert.equal(rows[0].status,'pending');assert.equal(rows[0].app_user_id,'retry');assert.equal(rows[0].request.manualRetry.actorUserId,'retry');
  const claim=runInNewContext(declaration('scripts/praktika-helper-job-processor.ts','claimNextJob')+'\nclaimNextJob',{
    supabase:db,jobEligible:async(actor:string)=>actor==='retry',nowIso:()=>new Date().toISOString(),WORKER_ID:'fixture',PERIO_READ_FIELDS:{},PraktikaJobQueueUnavailable:Error,
  });
  assert.equal(await claim('original',{}),null);
  const claimed=await claim('retry',{});assert.equal(claimed.id,'replacement');assert.equal(claimed.attempts,1);
  await create({appUserId:'retry',jobType:'update_praktika_letter_icons',request:{reportDraftId:'draft'}});
  assert.equal(rows[1].app_user_id,'retry');assert.equal(rows[1].request.continuationId,'intent');
});
