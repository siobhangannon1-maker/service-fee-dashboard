import assert from 'node:assert/strict';
import test from 'node:test';
import {toDraftListItem} from './draft-contract';
import {resolveWorkflow,unavailableWorkflow} from './resolved-workflow';
import {partitionApprovedForVerification} from './typist-approved-partition';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const approved=()=>toDraftListItem({id:'synthetic',provider_id:'synthetic-provider',status:'approved',provider_approved_at:'2026-11-11T00:00:00Z',created_at:'2026-11-11T00:00:00Z'},true);
test('new provider approval with no workflow remains Approved',()=>{
 const d=approved();d.workflow_resolved=resolveWorkflow(d,{uploads:[],icons:[],mediref:[],livePraktikaActors:new Set(),liveMediref:false});
 assert.equal(d.workflow_resolved.status,'not_started');assert.deepEqual(partitionApprovedForVerification([d]),{approved:[d],verificationItems:[]});
});
for(const status of ['draft','edited_by_typist','awaiting_provider_approval'])test(`${status} cannot enter Approved through a failure/verification flag`,()=>{
 const d=approved();d.status=status;d.workflow_status='failed';d.workflow_resolved=unavailableWorkflow();
 assert.deepEqual(partitionApprovedForVerification([d]),{approved:[],verificationItems:[]});
});
test('an approved-looking row without clinical approval proof requires verification',()=>{
 const d=approved();d.provider_approved_at=null;
 assert.deepEqual(partitionApprovedForVerification([d]),{approved:[],verificationItems:[d]});assert.equal(d.provider_approved_at,null);
});
for(const state of ['failed','active','unknown'] as const)test(`current ${state} workflow stays Approved`,()=>{
 const d=approved();d.workflow_continuation_context='present';d.workflow_status='failed';d.workflow_resolved={...unavailableWorkflow(),lookupUnavailable:false};d.workflow_resolved.branches.icon=state;
 assert.deepEqual(partitionApprovedForVerification([d]).approved,[d]);
});
for(const context of ['absent','unknown'] as const)for(const state of ['failed','running','completed'])test(`historical ${state} verification stays out of Approved with ${context} stale projection`,()=>{
 const d=approved();d.created_at='2026-08-01T00:00:00Z';d.workflow_status=state;d.uploaded_to_praktika=true;d.workflowStatusStale=true;d.workflow_continuation_context=context;d.workflow_resolved=unavailableWorkflow();
 assert.deepEqual(partitionApprovedForVerification([d]),{approved:[],verificationItems:[d]});
});
test('authoritatively completed approved letters leave Approved without changing clinical status',()=>{
 const d=approved();d.workflow_resolved={...unavailableWorkflow(),status:'completed',lookupUnavailable:false};
 assert.deepEqual(partitionApprovedForVerification([d]),{approved:[],verificationItems:[]});assert.equal(d.status,'approved');assert.ok(d.provider_approved_at);
});
test('idle/focus refresh is read-only, avoids overlap and stops after cleanup',async()=>{
 const listeners=new Map<string,()=>void>();let tick!:()=>void;let stopped=false,calls=0,release!:()=>void;
 const source=readFileSync('lib/report-writing/typist-list-refresh.ts','utf8');
 const start=runInNewContext(ts.transpileModule(source.replace('export function','function')+'\nstartTypistListRefresh',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
 AbortController,document:{hidden:false,addEventListener:(n:string,f:()=>void)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n)},
 window:{setInterval:(f:()=>void)=>{tick=f;return 1;},clearInterval:()=>{stopped=true;},addEventListener:(n:string,f:()=>void)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n)}}) as (fn:(s:AbortSignal)=>Promise<void>)=>()=>void;
 let signal!:AbortSignal;const stop=start(async s=>{calls++;signal=s;await new Promise<void>(resolve=>release=resolve);});
 assert.equal(calls,1);tick();listeners.get('focus')!();assert.equal(calls,1);
 release();await new Promise(resolve=>setImmediate(resolve));listeners.get('focus')!();assert.equal(calls,2);
 stop();assert.equal(signal.aborted,true);assert.equal(stopped,true);assert.equal(listeners.size,0);tick();assert.equal(calls,2);release();
});
