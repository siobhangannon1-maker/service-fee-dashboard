import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
function fixture(fenced=false) {
 const calls:string[]=[];const box={exports:{}};
 const code=ts.transpileModule(readFileSync('lib/report-writing/workflow-operation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const db={rpc:async(name:string)=>{calls.push(name);return{data:{ok:!fenced},error:null};}};
 const modules:Record<string,unknown>={'server-only':{},'node:crypto':{randomUUID},'next/server':{NextResponse:{json:Response.json}},'@/lib/auth':{sensitiveApiAccess:async()=>null},'@/lib/supabase/admin':{supabaseAdmin:db},'./workflow-execution-context':{currentWorkflowExecution:()=>null},'../mediref/manual-acknowledgement':{assertMedirefNotAcknowledged:async()=>{},MedirefAcknowledgementError:class extends Error{}}};
 runInNewContext(code,{...box,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Response});
 return {calls,run:(box.exports as {withWorkflowOperationRequest:Function}).withWorkflowOperationRequest};
}
const request=()=>new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({draftId:'00000000-0000-4000-8000-000000000001'})});
test('completed branch blocks direct MediRef before external invocation',async()=>{const f=fixture(true);const response=await f.run(request(),'mediref','/api/report-writing/send-via-mediref',()=>assert.fail('no delivery'));assert.equal(response.status,409);assert.deepEqual(f.calls,['begin_workflow_resolution_operation']);});
test('MediRef lost acknowledgement retains durable uncertainty',async()=>{const f=fixture();await assert.rejects(f.run(request(),'mediref','/api/report-writing/send-via-mediref',async()=>{throw new Error('Synthetic lost response');}));assert.deepEqual(f.calls,['begin_workflow_resolution_operation']);});
test('acknowledged request settles its own permit',async()=>{const f=fixture();await f.run(request(),'mediref','/api/report-writing/send-via-mediref',async()=>Response.json({success:true}));assert.deepEqual(f.calls,['begin_workflow_resolution_operation','settle_workflow_resolution_operation']);});
test('pre-insertion timeout cannot settle a still-running preparation',async()=>{const f=fixture();await f.run(request(),'mediref','/api/report-writing/send-via-mediref',async()=>Response.json({success:false,insertionOutcome:'not_attempted',deadlineExceeded:true},{status:503}));assert.deepEqual(f.calls,['begin_workflow_resolution_operation']);});
test('trusted stopped preparation without insertion settles safely',async()=>{const f=fixture();await f.run(request(),'mediref','/api/report-writing/send-via-mediref',async()=>Response.json({success:false,insertionOutcome:'not_attempted',deadlineExceeded:false},{status:503}));assert.deepEqual(f.calls,['begin_workflow_resolution_operation','settle_workflow_resolution_operation']);});
test('failed upload preparation leaves replay guarded by the next accepted plan',async()=>{const f=fixture();await f.run(request(),'praktika','/api/report-writing/upload-to-praktika',async()=>Response.json({success:false},{status:503}));assert.deepEqual(f.calls,['begin_workflow_resolution_operation','settle_workflow_resolution_operation']);});
