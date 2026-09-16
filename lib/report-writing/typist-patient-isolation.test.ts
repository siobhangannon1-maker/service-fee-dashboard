import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the actual page's handlers/effects with captured render values,
// controllable network responses and timers. No production APIs are contacted.
const path = 'app/(protected)/report-writing/typist/TypistPage.tsx';
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TypistPage') as ts.FunctionDeclaration;
const names = ['beginPatientSelection', 'savePatientDraft', 'getLetterTextForSave', 'selectDraft', 'applyDraftDetail', 'clearForm', 'startLetterFromQueue',
  'autoFillReferrerFromLatestPraktikaReferral', 'persistCurrentPatientDetails', 'persistCurrentReferrerDetails',
  'generateLetter', 'saveNewDraft', 'updateExistingDraft', 'ensureImageDraftForCurrentWork',
  'searchPraktikaPatientMatch', 'persistPraktikaPatientMatch'];
const handlers = names.map(name => {
  const fn = page.body!.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name); return fn.getText(ast);
}).join('\n');
const effects = page.body!.statements.flatMap(n => {
  if (!ts.isExpressionStatement(n) || !ts.isCallExpression(n.expression) || n.expression.expression.getText(ast) !== 'useEffect') return [];
  const callback = n.expression.arguments[0].getText(ast);
  return /pendingPatientSavesRef.current\.(letter|patient|referrer) = run/.test(callback) ? [callback] : [];
});
assert.equal(effects.length, 3);
type Values = Record<string, any>; // Dynamic VM bindings model existing page state.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const A = { id: 'draft-a', provider_id:'provider', updated_at:'2026-01-01', patient_name: 'Synthetic A', patient_dob: '2000-01-01', referrer_name: 'Referrer A', referrer_address: 'Address A', edited_text: 'Letter A', report_type: 'consultation_report', status: 'edited_by_typist' };
const B = { ...A, id: 'draft-b', patient_name: 'Synthetic B', patient_dob: null, referrer_name: null, referrer_address: null, edited_text: '' };
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture() {
  const state: Values = {};
  const globals: Values = {};
  for (const name of new Set((handlers + effects.join()).match(/\bset[A-Z]\w+/g))) {
    if (name === 'setTimeout') continue;
    const key = name.slice(3,4).toLowerCase() + name.slice(4);
    state[key] = undefined;
    globals[name] = (value: unknown) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  Object.assign(state, { selectedDraft:null, activeQueueItemId:null, selectedProviderId:'provider', drafts:[A,B], queue:[],
    patientName:'', patientFirstName:'', patientLastName:'', patientDob:'', referrerName:'', referrerAddress:'',
    letterText:'', generatedAiLetterText:'', typistQueries:'', clinicalNotes:'', pdfCcText:'', pdfLetterDate:'2026-01-01', pdfFontSize:10,
    saveStatus:'idle', reportType:'consultation_report', reportTypes:[], preferredExampleId:'', queueStatusTab:'active', imageDraftId:null });
  const stored = new Map([[A.id,{...A}],[B.id,{...B}]]);
  const refs = { selectedProviderIdRef:{current:'provider'}, detailLoaderRef:{current:async(id:string)=>({...stored.get(id)!})}, queueSelectionTokenRef:{current:0}, pendingPatientSavesRef:{current:{} as Values}, localDraftEditsRef:{current:new Map()}, patientSaveChainsRef:{current:new Map()},
    lastAutosavedTextRef:{current:''}, autosaveTimerRef:{current:null}, referrerAutosaveTimerRef:{current:null}, patientDetailsAutosaveTimerRef:{current:null}, autoImageDraftQueueIdRef:{current:null} };
  const timers = new Map<number,()=>void>(); let timerId=0;
  const requests: Array<{url:string;body:Values;reply:(data:Values)=>void}> = [];
  Object.assign(globals, refs, {
    console:{log(){},warn(){},error(){}}, alert(){}, confirm:()=>true,
    setTimeout:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;}, clearTimeout:(id:number)=>timers.delete(id),
    fetch:(url:string,init?:RequestInit)=>{
      const d=deferred<unknown>(); requests.push({url,body:init?.body?JSON.parse(String(init.body)):{},reply:data=>{const body=init?.body?JSON.parse(String(init.body)):{};if(data.success && stored.has(body.draftId) && typeof body.editedText==='string')stored.get(body.draftId)!.edited_text=body.editedText;d.resolve({ok:true,clone:()=>({json:async()=>data}),json:async()=>data,text:async()=>JSON.stringify(data)});}}); return d.promise;
    },
    cleanString:(x:unknown)=>String(x??'').trim(), splitPatientName:(x:string)=>{const [firstName='',...rest]=(x||'').split(' ');return {firstName,lastName:rest.join(' ')};},
    buildLetterTextForSave:(text:string)=>text, stripPdfMarkers:(text:string)=>text,
    extractPdfCcText:()=>'',extractPdfBodyFontSize:()=>10,extractPdfDateText:()=>'',DEFAULT_PDF_BODY_FONT_SIZE:10,
    getDraftClinicalNotes:(d:Values)=>d.source_text||'', asPlainObject:(v:unknown)=>v||{},
    inferReportTypeFromQueueItem:()=> 'consultation_report',getQueueAppointmentNotes:()=>'',getQueueSyncedClinicalNotes:()=>'',
    getQueueReferrerName:(i:Values)=>i.referrer_name||'',getQueueReferrerAddress:(i:Values)=>i.referrer_address||'',
    classifyReportTypeWithAi:async()=> 'consultation_report', cleanClinicalNoteText:(v:unknown)=>String(v||''),
    loadDrafts:async()=>{},loadQueue:async()=>{},
  });
  const script = ts.transpileModule(`(function(snapshot){const {${Object.keys(state).join(',')}}=snapshot;${handlers};return {${names.join(',')},effects:[${effects.join(',')}]};})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const factory = runInNewContext(script, globals);
  return { state, refs, requests, timers,
    render:()=>{state.patientName=[state.patientFirstName,state.patientLastName].filter(Boolean).join(' ');return factory({...state});},
    edit:(letter:string)=>{state.letterText=letter;},
  };
}

test('A edit -> immediate B -> return A -> rapid switches retain isolated values and captured save',async()=>{
 const f=fixture();await f.render().selectDraft(A);f.edit('Edited A');
 const cleanup=f.render().effects[0]();await f.render().selectDraft(B);cleanup();
 assert.equal(f.state.letterText,'');assert.equal(f.state.patientDob,'');assert.equal(f.state.referrerName,'');
 await settle();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.draftId,A.id);assert.equal(f.requests[0].body.editedText,'Edited A');
 for(const draft of [A,B,A,B]) {await f.render().selectDraft(draft);assert.equal(f.state.letterText,draft.id===A.id?'Edited A':'');}
 const before={...f.state};const savedRef=f.refs.lastAutosavedTextRef.current;
 f.requests[0].reply({success:true});await settle();
 assert.deepEqual(f.state,before);assert.equal(f.refs.lastAutosavedTextRef.current,savedRef);
 await f.render().selectDraft(A);assert.equal(f.state.letterText,'Edited A');
});
test('same-draft saves remain ordered while another patient can save independently',async()=>{
 const f=fixture();const api=f.render();
 const first=api.savePatientDraft(A.id,{body:JSON.stringify({draftId:A.id,editedText:'old'})});
 const second=api.savePatientDraft(A.id,{body:JSON.stringify({draftId:A.id,editedText:'new'})});
 const other=api.savePatientDraft(B.id,{body:JSON.stringify({draftId:B.id})});await settle();
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].body.draftId,B.id);
 f.requests[0].reply({success:true});await first;await settle();assert.equal(f.requests[2].body.editedText,'new');
 f.requests[1].reply({success:true});f.requests[2].reply({success:true});await Promise.all([second,other]);
});
for(const method of ['persistCurrentPatientDetails','persistCurrentReferrerDetails']) test(method+' late completion cannot populate B',async()=>{
 const f=fixture();await f.render().selectDraft(A);f.state.patientDob='2001-01-01';f.state.referrerName='Changed A';
 const save=f.render()[method]({quiet:true});await settle();await f.render().selectDraft(B);
 const before={...f.state};f.requests[0].reply({success:true});await save;
 for(const key of ['selectedDraft','patientDob','referrerName','referrerAddress','saveStatus','lastSavedAt'])assert.deepEqual(f.state[key],before[key]);
 assert.equal(f.requests[0].body.draftId,A.id);
});
for(const effect of [1,2]) test('pending metadata autosave survives switching: '+effect,async()=>{
 const f=fixture();await f.render().selectDraft(A);f.state.patientDob='2001-01-01';f.state.referrerName='Changed A';
 const cleanup=f.render().effects[effect]();await f.render().selectDraft(B);cleanup();await settle();
 assert.equal(f.requests[0].body.draftId,A.id);const before={...f.state};f.requests[0].reply({success:true});await settle();
 assert.deepEqual(f.state.selectedDraft,before.selectedDraft);assert.equal(f.state.saveStatus,before.saveStatus);
});
test('late referrer response cannot populate B or cache against B',async()=>{
 const f=fixture();await f.render().selectDraft(A);const lookup=f.render().autoFillReferrerFromLatestPraktikaReferral('synthetic-a','queue-a');
 await f.render().selectDraft(B);const before={...f.state};f.requests[0].reply({success:true,referral:{referrerName:'Old A',referrerAddress:'Old address'}});await lookup;
 assert.deepEqual(f.state,before);assert.equal(f.requests.length,1);
});
test('current referrer response with blank address clears previous address',async()=>{
 const f=fixture();await f.render().selectDraft(A);const lookup=f.render().autoFillReferrerFromLatestPraktikaReferral('synthetic-a');
 f.requests[0].reply({success:true,referral:{referrerName:'New',referrerAddress:null}});await lookup;assert.equal(f.state.referrerAddress,'');
});
test('linked queue restores its exact draft and standalone selection clears queue identity',async()=>{
 const f=fixture();await f.render().selectDraft(A);await f.render().startLetterFromQueue({id:'queue-b',report_draft_id:B.id,patient_first_name:'Stale queue name'});
 assert.equal(f.state.selectedDraft.id,B.id);assert.equal(f.state.activeQueueItemId,'queue-b');assert.equal(f.state.patientFirstName,'Synthetic');assert.equal(f.state.letterText,'');
 await f.render().selectDraft(A);assert.equal(f.state.activeQueueItemId,null);
});
test('late linked-draft load cannot replace a newer selection',async()=>{
 const f=fixture();const late=deferred<any>();
 f.refs.detailLoaderRef.current=async(id:string)=>id===A.id?late.promise:{...B};
 const load=f.render().startLetterFromQueue({id:'queue-a',report_draft_id:A.id});
 await settle();await f.render().selectDraft(B);late.resolve(A);await load;
 assert.equal(f.state.selectedDraft.id,B.id);assert.equal(f.state.letterText,'');
});
test('late generation response cannot replace B letter or save state',async()=>{
 const f=fixture();await f.render().selectDraft(A);const generation=f.render().generateLetter();await f.render().selectDraft(B);const before={...f.state};
 f.requests[0].reply({success:true,report:'Generated A'});await generation;assert.deepEqual(f.state,before);
});
test('late manual draft save still completes but cannot reselect A',async()=>{
 const f=fixture();f.state.patientFirstName='Synthetic';f.state.patientLastName='A';f.state.letterText='New A';
 const save=f.render().saveNewDraft('edited_by_typist');await f.render().selectDraft(B);const before={...f.state};
 f.requests[0].reply({success:true,draft:A});await save;assert.deepEqual(f.state,before);
});
test('late image-workspace creation cannot change B workspace',async()=>{
 const f=fixture();f.state.patientFirstName='Synthetic';f.state.patientLastName='A';f.state.autoGenerateStatus='ready';f.state.referralAutoFillStatus='found';
 const work=f.render().ensureImageDraftForCurrentWork({quiet:true});await f.render().selectDraft(B);
 f.requests[0].reply({success:true,draft:A});assert.equal(await work,A.id);assert.equal(f.state.imageDraftId,B.id);
});
test('late match results cannot select or persist a match for B',async()=>{
 const f=fixture();await f.render().selectDraft(A);const match=f.render().searchPraktikaPatientMatch();await f.render().selectDraft(B);const before={...f.state};
 f.requests[0].reply({success:true,candidates:[{id:'synthetic-a'}]});await match;assert.deepEqual(f.state,before);assert.equal(f.requests.length,1);
});
test('old A save completion cannot replace a newer A visit',async()=>{
 const f=fixture();await f.render().selectDraft(A);f.edit('First edit A');f.render().effects[0]();
 await f.render().selectDraft(B);await settle();await f.render().selectDraft(A);f.edit('Second edit A');f.render().effects[0]();
 const before={...f.state};const last=f.refs.lastAutosavedTextRef.current;
 f.requests[0].reply({success:true});await settle();assert.deepEqual(f.state,before);assert.equal(f.refs.lastAutosavedTextRef.current,last);
 await f.render().selectDraft(B);await settle();assert.equal(f.requests[1].body.draftId,A.id);assert.equal(f.requests[1].body.editedText,'Second edit A');
 f.requests[1].reply({success:true});await settle();await f.render().selectDraft(A);assert.equal(f.state.letterText,'Second edit A');
});
for(const method of ['persistCurrentPatientDetails','persistCurrentReferrerDetails'])test(method+' preserves explicit blanks in saved/UI metadata',async()=>{
 const f=fixture();await f.render().selectDraft(A);
 f.state.patientFirstName='';f.state.patientLastName='';f.state.patientDob='';f.state.referrerName='';f.state.referrerAddress='';
 const save=f.render()[method]({quiet:true});await settle();
 for(const field of ['patientName','patientDob','referrerName','referrerAddress']) assert.equal(f.requests[0].body[field],'');
 f.requests[0].reply({success:true});await save;
 for(const field of ['patient_name','patient_dob','referrer_name','referrer_address']) assert.equal(f.state.selectedDraft[field],null);
});

test('detail loading clears old content/images/settings and cannot autosave before loaded',async()=>{
 const f=fixture();await f.render().selectDraft(A);const late=deferred<any>();f.refs.detailLoaderRef.current=()=>late.promise;
 const load=f.render().selectDraft(B);assert.equal(f.state.selectedDraft,null);assert.equal(f.state.letterText,'');assert.equal(f.state.clinicalNotes,'');assert.equal(f.state.imageDraftId,null);assert.equal(f.state.pdfFontSize,10);
 assert.equal(f.render().effects[0](),undefined);assert.equal(f.state.detailLoading,true);
 late.resolve(B);await load;assert.equal((f.state.selectedDraft as unknown as Values).id,B.id);assert.equal(f.state.detailLoading,false);
});
test('detail failure leaves usable selection error, no A content or autosave target',async()=>{
 const f=fixture();await f.render().selectDraft(A);f.refs.detailLoaderRef.current=async()=>{throw new Error('PRIVATE');};
 await f.render().selectDraft(B);assert.equal(f.state.selectedDraft,null);assert.equal(f.state.letterText,'');assert.equal(f.state.imageDraftId,null);
 assert.match(f.state.detailError,/select it again/);assert.doesNotMatch(f.state.detailError,/PRIVATE/);assert.equal(f.render().effects[0](),undefined);
});
test('old provider detail cannot hydrate current provider',async()=>{
 const f=fixture();const late=deferred<any>();f.refs.detailLoaderRef.current=()=>late.promise;const load=f.render().selectDraft(A);
 f.refs.selectedProviderIdRef.current='other';f.render().clearForm();late.resolve(A);await load;assert.equal(f.state.selectedDraft,null);assert.equal(f.state.letterText,'');
});
test('settled successful save does not leave a persistent stale detail overlay',async()=>{
 const f=fixture();await f.render().selectDraft(A);f.edit('Saved edit');f.render().effects[0]();await f.render().selectDraft(B);await settle();
 f.requests[0].reply({success:true});await settle();assert.equal(f.refs.localDraftEditsRef.current.has(A.id),false);
 f.refs.detailLoaderRef.current=async()=>({...A,edited_text:'New authoritative edit'});
 await f.render().selectDraft(A);assert.equal(f.state.letterText,'New authoritative edit');
});

test('existing-draft detail selection preserves existing workflow option behavior',async()=>{
 const f=fixture();f.state.attachPeriodontalChart=true;
 await f.render().selectDraft(A);assert.equal(f.state.attachPeriodontalChart,true);
 await f.render().selectDraft(B);assert.equal(f.state.attachPeriodontalChart,true);
 f.render().clearForm();assert.equal(f.state.attachPeriodontalChart,false);
});
