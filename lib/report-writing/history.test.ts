import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { projectWorkflowRecovery, staleWorkflowStatus } from './workflow-recovery';
import { continuationIntentId } from './workflow-continuation-token';
const source = readFileSync('app/api/report-writing/get-drafts/route.ts','utf8');
const ast = ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const fn = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GET')!;
const code = ts.transpileModule(fn.getText(ast).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
async function run(mode: string) {
  const drafts = ['waiting_for_authentication','pending','running','completed','failed'].map((state,i)=>({id:`draft-${i}`,workflow_status:state==='failed'?'failed':'running',workflow_praktika_upload_status:state,workflow_mediref_status:i===0?'completed':'pending',workflow_icon_update_status:'pending'}));
  const db = {from(table:string){
    const q:any={select:()=>q,is:()=>q,order:()=>q,eq:()=>q,in:()=>q,abortSignal:()=>q,
      then(resolve:(v:unknown)=>void,reject:(v:unknown)=>void){
        if(mode==='throw'&&table==='praktika_helper_jobs')return Promise.reject(new Error('SECRET')).then(resolve,reject);
        const error=(table==='report_drafts'&&mode==='base_error')||(table==='praktika_helper_jobs'&&mode==='lookup_error');
        const data=table==='report_drafts'?drafts:[{id:continuationIntentId('draft-1'),status:'failed',response:{}},
          ...(mode==='one_bad'?[{id:continuationIntentId('draft-0'),status:'waiting',response:'SECRET'}]:[])];
        return Promise.resolve({data,error:error?{message:'SECRET_DATABASE_ERROR'}:null}).then(resolve,reject);
      }};return q;
  }};
  const route=runInNewContext(code+'\nGET',{supabase:db,projectWorkflowRecovery,staleWorkflowStatus,URL,NextResponse:{json:Response.json}});
  const response=await route(new Request('https://fixture.invalid/api/report-writing/get-drafts?providerId=all'));
  return {response,body:await response.json(),drafts};
}
for(const mode of ['normal','lookup_error','throw','one_bad','base_error'])test(`History route ${mode}`,async()=>{
  const {response,body,drafts}=await run(mode);
  assert.doesNotMatch(JSON.stringify(body),/SECRET/);
  if(mode==='base_error'){assert.equal(response.status,500);assert.equal(body.error,'Failed to load report drafts.');return;}
  assert.equal(response.status,200);assert.equal(body.success,true);assert.equal(body.drafts.length,5);
  if(['lookup_error','throw'].includes(mode))for(let i=0;i<drafts.length;i++){
    for(const [key,value]of Object.entries(drafts[i]))assert.equal(body.drafts[i][key],value);
    assert.equal(body.drafts[i].workflowStatusStale,true);
  }
  else {assert.equal(body.drafts[1].workflow_status,'failed');assert.equal(body.drafts[1].workflowStatusStale,undefined);}
  if(mode==='one_bad'){assert.equal(body.drafts[0].workflowStatusStale,true);assert.equal(body.drafts[0].workflow_mediref_status,'completed');assert.equal(body.drafts[2].workflowStatusStale,undefined);}
  assert.equal(body.drafts[0].workflow_praktika_upload_status,'waiting_for_authentication');
});
test('History route and reconciliation contain no mutation operations',()=>{
  const recovery=readFileSync('lib/report-writing/workflow-recovery.ts','utf8');
  assert.doesNotMatch(source+recovery,/\.(insert|update|upsert|delete|rpc)\s*\(/);
});
