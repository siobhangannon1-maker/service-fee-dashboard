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
  const db:any={from:(table:string)=>{assert.equal(table,'praktika_helper_jobs');let kind='';const q:any={select:()=>q,eq:(_key:string,value:string)=>{kind=value;return q;},in:()=>q,or:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
    then:(resolve:any)=>Promise.resolve({data:kind==='complete_report_workflow'?[{id:continuationIntentId('draft'),status:'failed',response:{stage:'upload'}}]:[{id:continuationChildId(continuationIntentId('draft'),'upload_report_to_praktika'),status:'failed'}]}).then(resolve)};return q;}};
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
  const ui=readFileSync('components/report-writing/RetryPraktikaButton.tsx','utf8');assert.ok(ui.includes('[draftId, workflowStatus, uploadStatus, recoveryMessage]'));assert.match(ui,/Check again/);assert.match(ui,/Praktika retry is already in progress/);
});

// Execute the real components with mocked hooks/fetch; effects run on mount and
// dependency changes, so passive requests and accidental timer polling are visible.
function controlFixture(kind: 'retry' | 'praktika' | 'mediref') {
  const name = kind === 'retry' ? 'RetryPraktikaButton' : 'ManualVerificationButton';
  const path = `components/report-writing/${name}.tsx`;
  const source = readFileSync(path, 'utf8').replace(/^import .*;$/gm, '').replace(/export function/g, 'function');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const state: any[] = [];
  const requests: { url: string; options: any }[] = [];
  let cursor = 0, deps: unknown[] | undefined, cleanup: (() => void) | undefined, callbacks = 0;
  let result: any = { eligible: true, priorJobId: 'prior' }, status = 200;
  let pending: Promise<Response> | undefined;
  const useState = (initial: any) => {
    const slot = cursor++; if (!(slot in state)) state[slot] = initial;
    return [state[slot], (value: any) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
  };
  const component = runInNewContext(js + `\n${name}`, {
    useState, useRef: (value: any) => useState({ current: value })[0],
    useEffect: (run: () => () => void, next: unknown[]) => {
      if (!deps || next.some((v, i) => v !== deps![i])) { cleanup?.(); deps = [...next]; cleanup = run(); }
    },
    setTimeout: () => assert.fail('Recovery must not schedule polling'),
    setInterval: () => assert.fail('Recovery must not schedule polling'),
    AbortController, encodeURIComponent,
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      return pending || Response.json(result, { status });
    },
  });
  let draftId = 'draft', workflowStatus = 'failed';
  const render = () => { cursor = 0; return component({ draftId, workflowStatus, integration: kind,
    onQueued: () => { callbacks++; }, onVerified: () => { callbacks++; } }); };
  const button = (tree: any, label: string): any => {
    if (!tree || typeof tree !== 'object') return undefined;
    if (tree.type === 'button' && tree.props.children.join('') === label) return tree;
    return (tree.props?.children || []).flat(Infinity).map((n: any) => button(n, label)).find(Boolean);
  };
  const openLabel = kind === 'retry' ? 'Retry Praktika' : `Mark ${kind === 'praktika' ? 'Praktika' : 'MediRef'} completed`;
  const yesLabel = kind === 'retry' ? 'Yes — retry Praktika' : `Yes — mark ${kind === 'praktika' ? 'Praktika' : 'MediRef'} completed`;
  return { render, button, requests, openLabel, yesLabel, callbacks: () => callbacks,
    reply: (value: any, code = 200) => { result = value; status = code; },
    defer: (value: Promise<Response>) => { pending = value; },
    change: () => { draftId = 'other-draft'; workflowStatus = 'running'; }, unmount: () => cleanup?.() };
}
for (const kind of ['retry', 'praktika', 'mediref'] as const) {
  test(`${kind}: one and 100 mounted recovery controls make zero requests and retain a visible action`, () => {
    for (let i = 0; i < 100; i++) {
      const f = controlFixture(kind); f.render(); const tree = f.render();
      assert.ok(f.button(tree, f.openLabel)); assert.equal(f.requests.length, 0);
      f.change(); f.render(); f.render(); assert.equal(f.requests.length, 0); f.unmount();
    }
  });
  test(`${kind}: explicit open checks once; cancel/reopen checks freshly; affirmative double-click mutates once`, async () => {
    const f = controlFixture(kind); f.render();
    const open = f.button(f.render(), f.openLabel);
    await Promise.all([open.props.onClick(), open.props.onClick()]);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.method, undefined);
    assert.ok(f.requests[0].url.includes(kind === 'retry' ? '/retry-praktika?' : '/verify-workflow-completion?'));
    if (kind !== 'retry') assert.ok(f.requests[0].url.includes(`integration=${kind}`));
    let tree = f.render(); assert.ok(f.button(tree, f.yesLabel)); assert.equal(f.callbacks(), 0);
    f.button(tree, 'Cancel').props.onClick();
    await f.button(f.render(), f.openLabel).props.onClick(); assert.equal(f.requests.length, 2);
    f.reply({ success: true }); tree = f.render(); const yes = f.button(tree, f.yesLabel);
    await Promise.all([yes.props.onClick(), yes.props.onClick()]);
    assert.equal(f.requests.length, 3); assert.equal(f.requests[2].options.method, 'POST');
    const body = JSON.parse(f.requests[2].options.body);
    assert.equal(body.draftId, 'draft'); assert.equal(body.priorJobId, 'prior');
    assert.equal(kind === 'retry' ? body.verifiedAbsent : body.verifiedSuccess, true);
    assert.equal(f.callbacks(), 1); f.unmount();
  });
  test(`${kind}: ineligible or failed lookup never enables confirmation or mutates`, async () => {
    for (const reason of ['workflow_not_terminal', 'replacement_active', 'lookup_unavailable', 'inactive_user']) {
      const f = controlFixture(kind); f.reply({ eligible: false, reason }, reason === 'lookup_unavailable' ? 503 : 200);
      f.render(); await f.button(f.render(), f.openLabel).props.onClick();
      for (let i = 0; i < 5; i++) f.render();
      assert.equal(f.requests.length, 1); assert.equal(f.button(f.render(), f.yesLabel), undefined);
      assert.equal(f.callbacks(), 0);
      if (kind === 'retry') { await f.button(f.render(), 'Check again').props.onClick(); assert.equal(f.requests.length, 2); }
      f.unmount();
    }
  });
  test(`${kind}: server mutation rejection never fabricates completion`, async () => {
    const f = controlFixture(kind); f.render(); await f.button(f.render(), f.openLabel).props.onClick();
    f.reply({ success: false, error: 'Current eligibility changed.' }, 409);
    await f.button(f.render(), f.yesLabel).props.onClick();
    assert.equal(f.callbacks(), 0); assert.match(JSON.stringify(f.render()), /Current eligibility changed/); f.unmount();
  });
  test(`${kind}: late eligibility response after identity change is ignored`, async () => {
    const f = controlFixture(kind); let resolve!: (response: Response) => void;
    f.defer(new Promise<Response>(r => { resolve = r; })); f.render();
    const request = f.button(f.render(), f.openLabel).props.onClick();
    f.change(); f.render(); assert.equal(f.requests[0].options.signal.aborted, true);
    resolve(Response.json({ eligible: true, priorJobId: 'old-prior' })); await request;
    assert.equal(f.button(f.render(), f.yesLabel), undefined); assert.equal(f.requests.length, 1); f.unmount();
  });
}
