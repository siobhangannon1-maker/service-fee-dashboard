import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {continuationChildId} from './workflow-continuation-token';
import {isConfirmedPraktikaIcon} from './praktika-icon-result';
import {isConfirmedPraktikaUpload} from './praktika-upload-result';
function fixture(plan:string[],jobs:Record<string,unknown[]>) {
 const calls:string[]=[];const ctx:unknown[]=[];const box={exports:{}};
 const intent={id:'parent',app_user_id:'actor',request:{reportDraftId:'draft',options:{actor:{actorUserId:'actor'}}},response:{resolution:{eventId:'event'},error:'Original failure'}};
 const event={id:'event',entity_id:'draft',action:'workflow_resolution_resume',details:{contract:'workflow-resolution-v1',plan}};
 const db={from:(table:string)=>{let id='';let update=false;const query:any={select:()=>query,eq:(key:string,value:string)=>{if(key==='id')id=value;return query;},update:(values:any)=>{update=true;if(values.response)assert.equal(values.response.error,'Original failure');return query;},single:async()=>({data:event,error:null}),maybeSingle:async()=>({data:{id},error:null}),then:(resolve:Function)=>resolve({data:update?[]:jobs[table==='mediref_helper_jobs'?'mediref':id]||[],error:null})};return query;},rpc:async(name:string)=>{calls.push(name);return {data:{ok:true},error:null};}};
 const modules:Record<string,unknown>={'server-only':{},'./workflow-continuation-token':{continuationChildId},'./praktika-icon-result':{isConfirmedPraktikaIcon},'./praktika-upload-result':{isConfirmedPraktikaUpload},'./workflow-execution-context':{withWorkflowExecution:async(value:unknown,fn:Function)=>{ctx.push(value);return fn();}}};
 const code=ts.transpileModule(readFileSync('lib/report-writing/resolution-continuation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{...box,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Response,Request});
 const handlers=Object.fromEntries(['praktika','icon','mediref'].map(branch=>[branch,async(req:Request)=>{calls.push(branch);const body=await req.json();assert.equal(body.draftId,'draft');return Response.json({success:true});}]));
 return{calls,ctx,run:()=>((box.exports as any).continueResolvedWorkflow)(db,intent,'owner','https://fixture.invalid',handlers)};
}
const upload=continuationChildId('parent','upload_report_to_praktika'),icon=continuationChildId('parent','update_praktika_letter_icons');
test('missing helper dispatches real normal upload first with server-owned plan context',async()=>{const f=fixture(['praktika','icon','mediref'],{});await f.run();assert.deepEqual(f.calls,['praktika','settle_workflow_resolution_execution']);assert.equal((f.ctx[0] as any).resolutionEventId,'event');});
test('exact pending helper waits without duplicate insertion',async()=>{const f=fixture(['praktika','icon','mediref'],{[upload]:[{status:'pending'}]});await f.run();assert.deepEqual(f.calls,['settle_workflow_resolution_execution']);});
test('confirmed upload dispatches only the next icon helper',async()=>{const f=fixture(['praktika','icon','mediref'],{[upload]:[{status:'completed',response:{patient_communication:{iFileId:42}}}]});await f.run();assert.deepEqual(f.calls,['icon','settle_workflow_resolution_execution']);});
test('confirmed upload/icons dispatch MediRef through existing handler',async()=>{const f=fixture(['praktika','icon','mediref'],{[upload]:[{status:'completed',response:{patient_communication:{iFileId:42}}}],[icon]:[{status:'completed',response:{appointment_icon1id:6597,appointment_icon2id:0,appointment_icon3id:0,appointment_icon4id:0}}]});await f.run();assert.deepEqual(f.calls,['mediref','settle_workflow_resolution_execution']);});
test('Kaur selective plan excludes retained preparation; completion uses fenced database RPC',async()=>{const f=fixture(['praktika','icon'],{[upload]:[{status:'completed',response:{patient_communication:{iFileId:42}}}],[icon]:[{status:'completed',response:{appointment_icon1id:6597,appointment_icon2id:0,appointment_icon3id:0,appointment_icon4id:0}}],mediref:[{status:'completed',result:{prepared:true,sent:false}}]});await f.run();assert.deepEqual(f.calls,['complete_resolved_workflow']);assert.equal(f.ctx.length,0);});
test('failed existing attempt cannot dispatch a duplicate',async()=>{const f=fixture(['praktika'],{[upload]:[{status:'failed'}]});await f.run();assert.deepEqual(f.calls,['settle_workflow_resolution_execution']);});
