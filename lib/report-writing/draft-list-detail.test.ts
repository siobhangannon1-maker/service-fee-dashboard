import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { draftListColumns, draftListSelect, mergeDraftWorkflow, toDraftDetail, toDraftListItem } from './draft-contract';
import { createDraftDetailLoader } from './draft-detail-loader';
import { readDraftList, readDocumentAvailability, finalTextFilter, readDraftPage, parseDraftPageQuery, cleanSearch, dobSearchValue, workflowIssueCandidates } from './draft-list-reader';
import type { SupabaseClient } from '@supabase/supabase-js';

const detail = toDraftDetail({ id:'00000000-0000-4000-8000-000000000001',provider_id:'provider',updated_at:'2026-01-01',
  source_text:'Synthetic notes',edited_text:'Letter <!--pdf-body-font-size:16-->',ai_generated_text:'Original',status:'approved',
  patient_name:'Synthetic',patient_dob:null,report_type:'consultation_report',created_at:'2026-01-01',referrer_name:null,
  referrer_address:null,typist_queries:null,typist_instructions:null,source_type:'clinical_notes' });
const list = toDraftListItem(detail, true);

test('list excludes every detail body and server-only historical preview',()=>{
 for(const field of ['source_text','edited_text','ai_generated_text','clinical_notes','source_clinical_notes','typist_instructions','typist_queries','referrer_address']) {
   assert.equal(field in list,false);assert.ok(!draftListColumns.includes(field as never));
 }
 assert.ok(draftListSelect.includes('praktika_letter_icon_update_response_preview'));
 assert.equal('praktika_letter_icon_update_response_preview' in toDraftListItem({...detail,praktika_letter_icon_update_response_preview:'private'},true),false);
 assert.equal(list.id,detail.id);assert.equal(list.updated_at,detail.updated_at);
 // @ts-expect-error A list is not a complete editor object.
 const invalid: typeof detail = list;
 void invalid;
});
test('polling merges workflow metadata without replacing body, notes, PDF settings or revision',()=>{
 const next=mergeDraftWorkflow(detail,{...list,updated_at:'newer',workflow_status:'running',workflow_mediref_status:'completed'});
 assert.equal(next.workflow_status,'running');assert.equal(next.workflow_mediref_status,'completed');
 for(const key of ['source_text','edited_text','ai_generated_text','clinical_notes','referrer_address','updated_at'] as const) assert.equal(next[key],detail[key]);
 assert.equal(mergeDraftWorkflow(detail,{...list,id:'other'}),detail);
 assert.equal(mergeDraftWorkflow(detail,{...list,provider_id:'other'}),detail);
});
for(const edited of [null,'','  ','text'])test(`detail availability preserves legacy text precedence ${JSON.stringify(edited)}`,()=>{
 const d=toDraftDetail({...detail,edited_text:edited,ai_generated_text:'fallback'});
 assert.equal(d.has_final_text,Boolean((edited||'fallback').trim()));
});
test('detail aliases preserve existing clinical notes transformation',()=>{
 assert.equal(detail.clinical_notes,'Synthetic notes');assert.equal(detail.source_clinical_notes,'Synthetic notes');
 assert.equal(toDraftDetail({...detail,clinical_notes:null,source_clinical_notes:null,source_text:null}).clinical_notes,null);
});
test('loader deduplicates in-flight only and explicit reselection fetches fresh detail',async()=>{
 let count=0;let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const load=createDraftDetailLoader(async()=>{count++;await gate;return Response.json({success:true,draft:detail});});
 const a=load(detail.id,'provider'),b=load(detail.id,'provider');assert.equal(a,b);assert.equal(count,1);
 release();assert.deepEqual(await a,detail);await b;await load(detail.id,'provider');assert.equal(count,2);
});
for(const change of [{id:'other'},{provider_id:'other'},{edited_text:undefined}])test(`detail loader rejects wrong or incomplete detail ${Object.keys(change)}`,async()=>{
 const load=createDraftDetailLoader(async()=>Response.json({success:true,draft:{...detail,...change}}));
 await assert.rejects(load(detail.id,'provider'),/Letter could not be loaded/);
});
test('loader never exposes raw server errors',async()=>{
 const load=createDraftDetailLoader(async()=>Response.json({success:false,error:'PRIVATE'}, {status:503}));
 await assert.rejects(load(detail.id,'provider'),error=>!String(error).includes('PRIVATE'));
});

function database(pages: Array<Record<string,unknown>[]>, errorAt=-1) {
 const calls: Array<Record<string,unknown>>=[];
 const db={from(table:string){const call:Record<string,unknown>={table};calls.push(call);const index=calls.length-1;
 const q:Record<string,unknown>={};for(const name of ['select','is','eq','or','order','range','abortSignal','returns','in','gte','lt'])q[name]=(...args:unknown[])=>{
   call[name]=args; if(name==='or')call.orAll=[...((call.orAll as unknown[])||[]),args[0]]; return q;};
 q.then=(resolve:(value:unknown)=>void)=>Promise.resolve({data:pages[index]||[],error:index===errorAt?{message:'PRIVATE'}:null}).then(resolve);return q;}};
 return {db:db as unknown as SupabaseClient,calls};
}
test('list paginates rather than silently truncating large providers, with explicit metadata only',async()=>{
 const rows=Array.from({length:500},(_,i)=>({id:String(i)}));const f=database([rows,[{id:'last'}]]);
 const found=await readDraftList(f.db,'provider');assert.equal(found.length,501);assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[1].range,[500,999]);assert.deepEqual(f.calls[0].eq,['provider_id','provider']);
 assert.deepEqual(f.calls[0].select,[draftListSelect]);
});
test('failed base page rejects entire list, not a misleading partial count',async()=>{
 const f=database([Array.from({length:500},(_,i)=>({id:String(i)})),[]],1);
 await assert.rejects(readDraftList(f.db,'provider'),/Draft list unavailable/);
});
test('availability transfers IDs/revisions only and keeps false distinct from unknown',async()=>{
 const f=database([[{id:'a',updated_at:'r'}],[{id:'b',updated_at:'r'}]]);
 const result=await readDocumentAvailability(f.db,'provider');assert.equal(result.get('a')?.available,true);assert.equal(result.get('b')?.available,false);
 for(const call of f.calls) assert.deepEqual(call.select,['id,updated_at']);
 assert.ok(finalTextFilter.includes('edited_text.is.null'));assert.ok(finalTextFilter.includes('edited_text.eq.""'));
});
test('failed availability page discards partial availability only',async()=>{
 const f=database([[{id:'a',updated_at:'r'}],[]],1);assert.equal((await readDocumentAvailability(f.db,'provider')).size,0);
});

const routeSource=readFileSync('app/api/report-writing/get-draft/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',routeSource,ts.ScriptTarget.Latest,true);
const routeFn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GET')!;
const code=ts.transpileModule(routeFn.getText(ast).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
class ApiAuthorizationError extends Error { constructor(public status:number){super();} }
async function route(mode:string,role='typist') {
 const calls:string[]=[];
 const db={from(table:string){calls.push(table);const q={select:()=>q,eq:()=>q,is:()=>q,abortSignal:()=>q,maybeSingle:async()=>({error:null,data:table==='user_roles'?{role}:table==='providers'?(mode==='inactive_provider'?null:{id:'provider',user_id:mode==='linked'?'actor':'other'}):mode==='deleted'?null:detail})};return q;}};
 const GET=runInNewContext(code+'\nGET',{NextResponse:{json:Response.json},headers:{'Cache-Control':'private, no-store'},ApiAuthorizationError,
 requireActiveApiUser:async()=>{if(['anonymous','inactive'].includes(mode))throw new ApiAuthorizationError(mode==='anonymous'?401:403);return {user:{id:'actor'},supabase:db};},supabaseAdmin:db,URL,AbortSignal,toDraftDetail});
 const response=await GET(new Request('https://fixture.invalid/api/report-writing/get-draft?id='+detail.id));return {response,calls};
}
for(const [mode,role,status] of [['anonymous','typist',401],['inactive','typist',403],['active','typist',200],['active','admin',200],['active','super_admin',200],['active','practice_manager',200],['active','provider_readonly',403],['linked','provider_readonly',200],['deleted','typist',404],['inactive_provider','typist',403]] as const)
 test(`detail authorization ${mode}/${role}`,async()=>{const r=await route(mode,role);assert.equal(r.response.status,status);if(mode==='anonymous'||mode==='inactive')assert.equal(r.calls.length,0);if(status===200)assert.equal(r.response.headers.get('Cache-Control'),'private, no-store');});
test('detail endpoint is read-only',()=>assert.doesNotMatch(routeSource,/\.(insert|update|upsert|delete|rpc)\s*\(/));
test('History uses metadata only and retains server-side PDF generation/audit rendering',()=>{
 const s=readFileSync('app/(protected)/report-writing/history/page.tsx','utf8');assert.doesNotMatch(s,/draft\.(edited_text|ai_generated_text)/);
 assert.match(s,/draft.has_final_text !== false/);assert.match(s,/JSON.stringify\(\{ draftId: draft.id \}\)/);assert.match(s,/ManualVerificationHistory entries=\{draft.workflow_manual_verification\}/);
});
test('Provider selects detail rather than injecting a list item into review',()=>{
 const s=readFileSync('app/(protected)/report-writing/provider/ProviderReportClient.tsx','utf8');assert.match(s,/useState<DraftListItem\[\]>/);
 assert.match(s,/await detailLoaderRef.current\(item.id, providerId\)/);assert.match(s,/token !== detailSelectionRef.current/);assert.match(s,/applyApprovalDraft\(draft\)/);
});
test('Queue hydration is still proactive and independent of selected detail',()=>{
 const s=readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx','utf8');const block=s.slice(s.indexOf('  async function loadQueue('),s.indexOf('  useEffect(() => {\n    setMounted'));
 assert.match(block,/setQueue\(data.queue\)/);assert.match(block,/await hydrateQueueInBackground/);assert.match(block,/15000/);assert.doesNotMatch(block,/detailLoader|selectDraft|selectedDraft/);
});

function providerSelectionFixture() {
 const path='app/(protected)/report-writing/provider/ProviderReportClient.tsx';const source=readFileSync(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const page=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ProviderReportClient') as ts.FunctionDeclaration;
 const names=['resetLetterEditor','selectProviderDraft','applyDraftToEditor','applyApprovalDraft','unapproveLetter'];
 const handlers=names.map(name=>page.body!.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(ast)).join('\n');
 const state:Record<string,unknown>={};const globals:Record<string,unknown>={providerId:'provider',reportTypes:[],getReportText:(d:typeof detail)=>d.edited_text||d.ai_generated_text||'',formatDateTime:()=>'',splitPatientName:()=>({firstName:'Synthetic',lastName:''})};
 for(const setter of new Set(handlers.match(/\bset[A-Z]\w+/g)))globals[setter]=(v:unknown)=>{state[setter]=v;};
 let reply!:(r:Response)=>void;Object.assign(globals,{fetch:()=>new Promise<Response>(resolve=>{reply=resolve;}),readJsonSafely:(r:Response)=>r.json(),confirm:()=>true,alert:()=>{},loadDrafts:async()=>{}});
 const pending=new Map<string,(d:typeof detail)=>void>();const token={current:0};const provider={current:'provider'};
 Object.assign(globals,{detailSelectionRef:token,detailProviderRef:provider,detailLoaderRef:{current:(id:string)=>new Promise(resolve=>pending.set(id,resolve))}});
 const js=ts.transpileModule(handlers+'\n({selectProviderDraft,unapproveLetter})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const methods=runInNewContext(js,globals);return {select:methods.selectProviderDraft as (d:typeof list,v:string)=>Promise<void>,unapprove:methods.unapproveLetter as (d:typeof detail)=>Promise<void>,reply:(r:Response)=>reply(r),state,pending,token,provider};
}
test('Provider A-to-B late detail cannot replace the selected review',async()=>{
 const f=providerSelectionFixture();const a=f.select(list,'approval');const b=f.select({...list,id:'b'},'approval');
 f.pending.get('b')!({...detail,id:'b',edited_text:'B'});await b;f.pending.get(detail.id)!(detail);await a;
 assert.equal((f.state.setSelectedApprovalDraft as typeof detail).id,'b');
});
test('Provider change invalidates pending selected letter',async()=>{
 const f=providerSelectionFixture();const a=f.select(list,'approved');f.provider.current='other';f.token.current++;
 f.pending.get(detail.id)!(detail);await a;assert.equal(f.state.setSelectedApprovedDraft,null);
});

test('Provider in-flight selected-letter update cannot replace a later selection',async()=>{
 const f=providerSelectionFixture();const save=f.unapprove(detail);const select=f.select({...list,id:'b'},'approval');
 f.pending.get('b')!({...detail,id:'b',edited_text:'B'});await select;
 f.reply(Response.json({success:true,draft:detail}));await save;
 assert.equal((f.state.setSelectedApprovalDraft as typeof detail).id,'b');
});

function queueFixture() {
 const path='app/(protected)/report-writing/typist/TypistPage.tsx';const source=readFileSync(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const page=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TypistPage') as ts.FunctionDeclaration;
 const handler=page.body!.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='loadQueue')!;
 let provider='a',hydrations=0;let reply!:(r:Response)=>void;let queue:unknown[]=[];const timers:number[]=[];
 const globals={providerDataRequestRef:{current:1},queueStatusTab:'active',URLSearchParams,
 queueListRequestSequenceRef:{current:0},queueSelectionTokenRef:{current:0},draftListMountedRef:{current:true},
 queueWorkspaceRef:{current:{listTab:'queue',activeQueueItemId:null}},clearForm:()=>assert.fail('No Queue selection to clear'),
 fetch:()=>new Promise<Response>(r=>{reply=r;}),setQueue:(q:unknown[])=>{queue=q;},
 isCurrentProviderDataRequest:(id:string)=>id===provider,
 hydrateQueueInBackground:async()=>{hydrations++;return {enqueued:1};},window:{setTimeout:(_fn:unknown,ms:number)=>timers.push(ms)}};
 const load=runInNewContext(ts.transpileModule(handler.getText(ast)+'\nloadQueue',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,globals) as (id:string)=>Promise<void>;
 return {load,reply:(items:unknown[])=>reply(Response.json({success:true,queue:items})),provider:(id:string)=>{provider=id;},queue:()=>queue,hydrations:()=>hydrations,timers};
}
test('Queue cards load and proactively request hydration without selected detail',async()=>{
 const f=queueFixture();const pending=f.load('a');f.reply([{id:'queue-1'},{id:'queue-2'}]);await pending;
 assert.equal(f.queue().length,2);assert.equal(f.hydrations(),1);assert.deepEqual(f.timers,[15000]);
});
test('old-provider Queue response cannot populate cards or launch stale hydration',async()=>{
 const f=queueFixture();const pending=f.load('a');f.provider('b');f.reply([{id:'queue-a'}]);await pending;
 assert.equal(f.queue().length,0);assert.equal(f.hydrations(),0);
});
test('Queue refresh installs hydrated card data independently of letter detail',async()=>{
 const f=queueFixture();let pending=f.load('a');f.reply([{id:'queue-1'}]);await pending;
 pending=f.load('a');f.reply([{id:'queue-1',referrer_name:'Synthetic referral',raw_json:{cached_clinical_notes:'Synthetic notes'}}]);await pending;
 assert.equal((f.queue()[0] as {referrer_name:string}).referrer_name,'Synthetic referral');assert.equal(f.hydrations(),2);
});

test('History page query: only with limit, bounded, and unsafe values dropped',()=>{
 assert.equal(parseDraftPageQuery(new URLSearchParams('providerId=all')),null);
 const p=parseDraftPageQuery(new URLSearchParams('limit=999&providerId=bad&reportType=all&from=2026-1-1&to=2026-11-16&cursor=x|y&q=Smith, (Jo)*'))!;
 assert.equal(p.limit,200);assert.equal(p.providerId,null);assert.equal(p.reportType,null);assert.equal(p.from,null);assert.equal(p.to,'2026-11-16');
 assert.equal(p.cursor,null);assert.equal(p.q,'Smith Jo');
 assert.equal(cleanSearch('a,b(c)*d%e\\f"g\'h:i'),'a b c d e f g h i');
});
test('History page reads one page newest first with server-side filters and a stable cursor',async()=>{
 const rows=Array.from({length:3},(_,i)=>({id:`00000000-0000-0000-0000-00000000000${i}`,created_at:`2026-11-0${9-i}T00:00:00.000Z`}));
 const f=database([rows]);
 const page=await readDraftPage(f.db,{providerId:'11111111-1111-1111-1111-111111111111',limit:2,
   cursor:{createdAt:'2026-11-10T00:00:00.000Z',id:'22222222-2222-2222-2222-222222222222'},q:'Smith',reportType:'consultation_report',from:'2026-11-01',to:'2026-11-09'});
 assert.deepEqual(page.rows.map(r=>r.id),[rows[0].id,rows[1].id]);
 assert.equal(page.nextCursor,`2026-11-08T00:00:00.000Z|${rows[1].id}`);
 const call=f.calls[0];
 assert.deepEqual(call.range,[0,2]);assert.deepEqual(call.select,[draftListSelect]);
 assert.deepEqual(call.gte,['created_at','2026-11-01T00:00:00.000Z']);assert.deepEqual(call.lt,['created_at','2026-11-10T00:00:00.000Z']);
 const ors=call.orAll as string[];
 assert.ok(ors[0].includes('patient_name.ilike.*Smith*')&&ors[0].includes('referrer_name.ilike.*Smith*'));
 assert.equal(ors[1],'created_at.lt.2026-11-10T00:00:00.000Z,and(created_at.eq.2026-11-10T00:00:00.000Z,id.gt.22222222-2222-2222-2222-222222222222)');
 const last=await readDraftPage(database([rows.slice(0,1)]).db,{providerId:null,limit:2,cursor:null,q:'',reportType:null,from:null,to:null});
 assert.equal(last.nextCursor,null);
});
test('page availability checks only that page of letters',async()=>{
 const f=database([[{id:'a',updated_at:'r'}],[]]);
 await readDocumentAvailability(f.db,null,['a','b']);
 for(const call of f.calls)assert.deepEqual(call.in,['id',['a','b']]);
});

test('date of birth search accepts YYYY-MM-DD, DD/MM/YYYY and D/M/YYYY and rejects impossible dates',()=>{
 assert.equal(dobSearchValue('1990-06-09'),'1990-06-09');
 assert.equal(dobSearchValue('09/06/1990'),'1990-06-09');
 assert.equal(dobSearchValue('9/6/1990'),'1990-06-09');
 assert.equal(dobSearchValue('31/02/1990'),null);
 assert.equal(dobSearchValue('6/1990'),null);
 assert.equal(dobSearchValue('Smith'),null);
 assert.equal(cleanSearch('9/6/1990'),'9/6/1990');
});
test('History page searches dates of birth in the stored format and Issues across all letters on the server',async()=>{
 const f=database([[]]);
 await readDraftPage(f.db,{providerId:null,limit:100,cursor:null,q:'9/6/1990',reportType:null,from:null,to:null,issues:true});
 const ors=f.calls[0].orAll as string[];
 assert.ok(ors[0].includes('patient_dob.eq.1990-06-09'));
 assert.ok(ors[0].includes('patient_name.ilike.*9/6/1990*'));
 assert.equal(ors[1],workflowIssueCandidates);
 assert.equal(parseDraftPageQuery(new URLSearchParams('limit=100&status=issues'))!.issues,true);
 assert.equal(parseDraftPageQuery(new URLSearchParams('limit=100&status=approved'))!.issues,false);
 for(const fragment of ['workflow_praktika_upload_status.eq.error','workflow_icon_update_status.eq.error','workflow_periodontal_chart_status.eq.error',
   'workflow_mediref_status.in.(error,failed)','workflow_error.not.is.null','praktika_letter_icon_updated_at.is.null','periodontal_chart_attached_at.is.null'])
   assert.ok(workflowIssueCandidates.includes(fragment),fragment);
});
