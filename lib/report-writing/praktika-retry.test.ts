import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { remainsInApproved } from './praktika-retry';
import { projectWorkflowRecovery } from './workflow-recovery';
import { continuationIntentId, continuationChildId } from './workflow-continuation-token';

for(const status of ['failed','running','waiting_for_authentication','pending']) test(`unfinished ${status} upload retained after MediRef completion`,()=>{
  assert.equal(remainsInApproved({status:'approved',emailed_to_referrer_at:'synthetic',workflow_status:'failed',workflow_praktika_upload_status:status,workflow_mediref_status:'completed'}),true);
});
test('stored completion flags alone cannot remove a workflow from Approved',()=>{
  const d={status:'uploaded_to_praktika',workflow_status:'running',workflow_praktika_upload_status:'completed',workflow_mediref_status:'completed',workflow_icon_update_status:'failed'};
  assert.equal(remainsInApproved(d),true);assert.equal(remainsInApproved({...d,workflow_icon_update_status:'completed'}),true);
  assert.equal(remainsInApproved({status:'approved'}),true);assert.equal(remainsInApproved({status:'approved',emailed_to_referrer_at:'synthetic'}),true);
});
function declaration(path:string,name:string){const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;return ts.transpileModule(fn.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
const routePath='app/api/report-writing/retry-praktika/route.ts';
const code=['retryAccess','retryDraft','POST','GET'].map(name=>declaration(routePath,name)).join('\n');
class AuthError extends Error { constructor(public status:number,message:string){super(message);} }
function routeFixture(){
  const calls:unknown[]=[];let denial:Response|null=null, valid=true, rpcError=false;
  const state={actor:'actor',role:'typist',active:true,provider:true,lookupError:false,parentStatus:'failed',childStatus:'failed',stage:'upload',draftStatus:'approved',original:'original'};
  const mocks={requireActiveApiUser:async(roles:string[])=>{
      if(denial)throw new AuthError(denial.status,'denied');
      if(!state.active)throw new AuthError(403,'An active account is required.');
      if(!roles.includes(state.role))throw new AuthError(403,'Access denied.');
      return{user:{id:state.actor}};
    },ApiAuthorizationError:AuthError,continuationIntentId:()=> 'intent',validWorkflowAuthorization:(_draft:string,actor:string)=>{assert.equal(actor,state.original);return valid;},workflowConfigurationIssue:()=>null,AbortSignal,URL,NextResponse:{json:Response.json},process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic'}},
    supabaseAdmin:{from:(table:string)=>{
      let single=true;
      const result=()=>({data:table==='report_drafts'?{status:state.draftStatus,provider_id:'server-provider',deleted_at:null,uploaded_to_praktika:false}
        :table==='providers'?state.provider?{id:'server-provider'}:null
        :single?{id:'intent',status:state.parentStatus,app_user_id:state.original,response:{stage:state.stage},request:{options:{}}}
        :[{id:'prior',status:state.childStatus,request:{continuationId:'intent'}}],error:state.lookupError?{message:'SECRET'}:null});
      const q:any={select:()=>q,eq:(key:string,value:string)=>{if(table==='providers'&&key==='id')assert.equal(value,'server-provider');return q;},abortSignal:()=>q,maybeSingle:async()=>result(),then:(resolve:any)=>{single=false;return Promise.resolve(result()).then(resolve);}};return q;
    },rpc:(name:string,args:unknown)=>{calls.push({name,args});return{abortSignal:async()=>rpcError?{error:{message:'SECRET'}}:{data:{ok:true,uploadJobId:'replacement'}}};}}};
  const call=(body:unknown)=>runInNewContext(code+'\nPOST',mocks)(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)}));
  const get=()=>runInNewContext(code+'\nGET',mocks)(new Request('https://fixture.invalid?draftId=11111111-1111-1111-1111-111111111111'));
  return{calls,call,get,state,setDenied:(r:Response)=>{denial=r;},setInvalid:()=>{valid=false;},setError:()=>{rpcError=true;}};
}
const body={draftId:'11111111-1111-1111-1111-111111111111',priorJobId:'22222222-2222-2222-2222-222222222222',verifiedAbsent:true};
for(const status of [401,403])test(`authorization ${status} denies before reservation`,async()=>{const f=routeFixture();f.setDenied(Response.json({success:false},{status}));assert.equal((await f.call(body)).status,status);assert.equal(f.calls.length,0);});
test('confirmation required and actor comes only from server',async()=>{const f=routeFixture();assert.equal((await f.call({...body,verifiedAbsent:false})).status,400);assert.equal(f.calls.length,0);assert.equal((await f.call({...body,actorUserId:'attacker'})).status,202);assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:'reserve_praktika_upload_retry',args:{p_draft_id:body.draftId,p_prior_job_id:body.priorJobId,p_actor_user_id:'actor'}}]);});
test('invalid workflow authorization never reserves',async()=>{const f=routeFixture();f.setInvalid();assert.equal((await f.call(body)).status,403);assert.equal(f.calls.length,0);});
test('uncertain reservation acknowledgement sanitized',async()=>{const f=routeFixture();f.setError();const r=await f.call(body);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SECRET/);});
test('authoritative failed child projects failed without mutating durable fields or querying MediRef',async()=>{
  const d={id:'draft',workflow_status:'failed',workflow_praktika_upload_status:'running',workflow_mediref_status:'completed'};
  const db:any={from:(table:string)=>{assert.equal(table,'praktika_helper_jobs');const q:any={select:()=>q,eq:()=>q,in:()=>q,abortSignal:()=>q,
    then:(resolve:any)=>Promise.resolve({data:[{id:continuationIntentId('draft'),status:'failed',response:{stage:'upload'}}]}).then(resolve),
    maybeSingle:async()=>({data:{id:continuationChildId(continuationIntentId('draft'),'upload_report_to_praktika'),status:'failed'}})};return q;}};
  const result:any=(await projectWorkflowRecovery(db,[d]))[0];assert.equal(result.workflow_praktika_upload_status,'failed');assert.equal(result.workflow_last_message,'Praktika upload needs verification.');assert.equal(result.workflow_mediref_status,'completed');assert.equal(d.workflow_praktika_upload_status,'running');
});
test('confirmation has separate cancel and affirmative controls; no mount-time mutation',()=>{
  const ui=readFileSync('components/report-writing/RetryPraktikaButton.tsx','utf8');
  assert.match(ui,/Have you checked the patient's file in Praktika and confirmed that this letter is not already there\?/);
  assert.match(ui,/Retrying may create a duplicate if the previous upload actually succeeded\./);
  assert.match(ui,/onClick=\{\(\) => setConfirming\(false\)\}>Cancel/);assert.match(ui,/Yes — retry Praktika/);
  assert.match(ui,/if \(!confirming \|\| !priorJobId \|\| submitting.current\) return/);
});

test('waiting replacement activation is conditional and never resets runnable or terminal jobs',async()=>{
  const activate=declaration('lib/praktika/helper-jobs.ts','createPraktikaHelperJob');
  for(const status of ['waiting','pending','processing','completed','failed']){
    const row:any={id:'replacement',status,request:{manualRetry:{verifiedAbsent:true,priorJobId:'old'}}};let updates=0;
    const db:any={from:()=>{let patch:any;const q:any={select:()=>q,eq:()=>q,single:async()=>({data:row}),update:(p:any)=>{patch=p;return q;},maybeSingle:async()=>{updates++;Object.assign(row,patch);return{data:row};}};return q;}};
    const fn=runInNewContext(activate+'\ncreatePraktikaHelperJob',{supabaseAdmin:db,currentWorkflowExecution:()=>({intentId:'intent',retryUploadId:'replacement'}),Date});
    const result=await fn({appUserId:'actor',jobType:'upload_report_to_praktika',request:{reportDraftId:'draft'}});
    assert.equal(updates,status==='waiting'?1:0);assert.equal(result.status,status==='waiting'?'pending':status);assert.equal(result.request.manualRetry.priorJobId,'old');
  }
});

test('button requires affirmative confirmation; cancel and duplicate click are safe',async()=>{
  const source=readFileSync('components/report-writing/RetryPraktikaButton.tsx','utf8').replace(/^import .*;$/gm,'').replace('export function','function');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const state:any[]=[];let cursor=0,effectRun=false,posts=0,queued=0;
  const useState=(initial:any)=>{const slot=cursor++;if(!(slot in state))state[slot]=initial;return[state[slot],(value:any)=>{state[slot]=value;}];};
  const component=runInNewContext(js+'\nRetryPraktikaButton',{
    setTimeout,clearTimeout,useState,useRef:(value:any)=>useState({current:value})[0],useEffect:(run:()=>void)=>{if(!effectRun){effectRun=true;run();}},AbortController,encodeURIComponent,
    React:{createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}})},
    fetch:async(_url:string,options:any)=>{if(options.method==='POST'){posts++;assert.equal(JSON.parse(options.body).verifiedAbsent,true);return Response.json({success:true});}return Response.json({eligible:true,priorJobId:'prior'});},
  });
  const render=()=>{cursor=0;return component({draftId:'draft',onQueued:()=>{queued++;}});};
  const button=(tree:any,label:string):any=>{if(!tree||typeof tree!=='object')return null;if(tree.type==='button'&&tree.props.children.includes(label))return tree;return(tree.props?.children||[]).flat(Infinity).map((n:any)=>button(n,label)).find(Boolean);};
  render();await new Promise(resolve=>setImmediate(resolve));let tree=render();assert.equal(posts,0);
  button(tree,'Retry Praktika').props.onClick();tree=render();button(tree,'Cancel').props.onClick();assert.equal(posts,0);
  tree=render();button(tree,'Retry Praktika').props.onClick();tree=render();
  const yes=button(tree,'Yes — retry Praktika');await Promise.all([yes.props.onClick(),yes.props.onClick()]);assert.equal(posts,1);assert.equal(queued,1);
});

for(const role of ['admin','super_admin','practice_manager','typist']) test(`active ${role} can recover another actor workflow`,async()=>{
  const f=routeFixture();f.state.role=role;assert.equal((await (await f.get()).json()).eligible,true);assert.equal((await f.call({...body,providerId:'forged',actorUserId:'forged',role:'super_admin'})).status,202);
});
for(const role of ['staff','billing_staff','provider_readonly']) test(`${role} cannot bypass retry authorization`,async()=>{
  const f=routeFixture();f.state.role=role;assert.equal((await f.get()).status,403);assert.equal((await f.call(body)).status,403);assert.equal(f.calls.length,0);
});
test('original actor is also permitted',async()=>{const f=routeFixture();f.state.actor=f.state.original;assert.equal((await f.call(body)).status,202);});
test('inactive actor denied on GET and POST',async()=>{const f=routeFixture();f.state.active=false;assert.equal((await (await f.get()).json()).reason,'inactive_user');assert.equal((await f.call(body)).status,403);assert.equal(f.calls.length,0);});
test('inactive provider denied using server draft provider',async()=>{const f=routeFixture();f.state.provider=false;assert.equal((await (await f.get()).json()).reason,'unauthorized_for_provider');assert.equal((await f.call({...body,providerId:'forged'})).status,403);assert.equal(f.calls.length,0);});
for(const [field,value,reason] of [['parentStatus','processing','workflow_not_terminal'],['childStatus','pending','replacement_active'],['childStatus','completed','upload_not_failed'],['draftStatus','draft','invalid_state'],['stage','prepare','invalid_state']] as const)test(`GET exposes safe ${reason}`,async()=>{const f=routeFixture();f.state[field]=value;const r=await(await f.get()).json();assert.equal(r.reason,reason);assert.equal(r.eligible,false);assert.equal(f.calls.length,0);});
test('lookup failure is safe and read-only',async()=>{const f=routeFixture();f.state.lookupError=true;const r=await f.get();assert.equal(r.status,503);assert.deepEqual(await r.json(),{eligible:false,reason:'lookup_unavailable'});assert.equal(f.calls.length,0);});
test('Approved card uses authoritative recovery candidate and supplies recheck fields',()=>{
  const s=readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx','utf8');assert.match(s,/approvedWorkflow\(draft\).praktikaRecovery && <>/);for(const prop of ['workflowStatus','uploadStatus','recoveryMessage'])assert.ok(s.includes(prop+'={draft.'));
  const ui=readFileSync('components/report-writing/RetryPraktikaButton.tsx','utf8');assert.ok(ui.includes('[draftId, workflowStatus, uploadStatus, recoveryMessage, check]'));assert.match(ui,/Check again/);assert.match(ui,/Praktika retry is already in progress/);
});

test('recovery UI exposes lookup failure, rechecks transitions, and never reserves on GET',async()=>{
  const source=readFileSync('components/report-writing/RetryPraktikaButton.tsx','utf8').replace(/^import .*;$/gm,'').replace('export function','function');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const state:any[]=[];let cursor=0,gets=0,posts=0,deps:unknown[]|undefined,cleanup:(()=>void)|undefined,timer:(()=>void)|undefined;
  let result:any={eligible:false,reason:'lookup_unavailable'};
  const useState=(initial:any)=>{const slot=cursor++;if(!(slot in state))state[slot]=initial;return[state[slot],(value:any)=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];};
  const component=runInNewContext(js+'\nRetryPraktikaButton',{
    useState,useRef:(value:any)=>useState({current:value})[0],
    useEffect:(run:()=>()=>void,next:unknown[])=>{if(!deps||next.some((v,i)=>v!==deps![i])){cleanup?.();deps=[...next];cleanup=run();}},
    setTimeout:(fn:()=>void,ms:number)=>{assert.equal(ms,15000);timer=fn;return 1;},clearTimeout:()=>{timer=undefined;},AbortController,encodeURIComponent,
    React:{createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}})},
    fetch:async(_url:string,options:any)=>{if(options.method==='POST')posts++;else gets++;return Response.json(result,{status:result.reason==='lookup_unavailable'?503:200});},
  });
  let workflowStatus='running';
  const render=()=>{cursor=0;return component({draftId:'draft',workflowStatus,uploadStatus:'failed',recoveryMessage:'verification',onQueued:()=>{}});};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const button=(tree:any,label:string):any=>{if(!tree||typeof tree!=='object')return null;if(tree.type==='button'&&tree.props.children.includes(label))return tree;return(tree.props?.children||[]).flat(Infinity).map((n:any)=>button(n,label)).find(Boolean);};
  render();await settle();let tree=render();assert.match(JSON.stringify(tree),/Retry availability could not be checked/);
  result={eligible:false,reason:'workflow_not_terminal'};button(tree,'Check again').props.onClick();render();await settle();tree=render();assert.match(JSON.stringify(tree),/Preparing Praktika retry options/);assert.equal(gets,2);assert.ok(timer);
  timer!();render();await settle();render();assert.equal(gets,3);
  result={eligible:true,reason:'eligible',priorJobId:'prior'};workflowStatus='failed';render();await settle();tree=render();assert.ok(button(tree,'Retry Praktika'));assert.equal(gets,4);
  result={eligible:false,reason:'replacement_active'};workflowStatus='running';render();await settle();tree=render();assert.match(JSON.stringify(tree),/Praktika retry is already in progress/);assert.equal(button(tree,'Retry Praktika'),undefined);
  assert.equal(posts,0);cleanup?.();
});
