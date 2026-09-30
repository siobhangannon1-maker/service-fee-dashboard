import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actionBucket,offlineGet,auditSequentially,specificReason} from './approved-recovery-audit';
import {unavailableWorkflow,type WorkflowDraft} from '../lib/report-writing/resolved-workflow';
import {continuationIntentId} from '../lib/report-writing/workflow-continuation-token';
const id='11111111-1111-4111-8111-111111111111';
const checks={retry:{eligible:false},mediref:{eligible:false},workflow:{eligible:false}};
function draft():WorkflowDraft{return {id,status:'approved',emailed_to_referrer_at:'2026-01-01',workflow_resolved:{...unavailableWorkflow(),lookupUnavailable:false}};}
test('historical old emailed field does not prove delivery or enable retry',()=>{
  assert.equal(actionBucket(draft(),checks,false),'historical_delivery_unconfirmed');
});
test('projection failure cannot be classified as available action',()=>{
  const d=draft();d.workflow_resolved!.lookupUnavailable=true;
  assert.equal(actionBucket(d,{...checks,retry:{eligible:true}},true),'unresolved_no_safe_action');
});
test('action precedence is exclusive and active state comes only from resolver',()=>{
  assert.equal(actionBucket(draft(),{...checks,retry:{eligible:true},mediref:{eligible:true}},true),'retry_praktika_available');
  const d=draft();d.workflow_resolved!.status='completing';
  assert.equal(actionBucket(d,checks,true),'genuinely_active_workflow');
});
test('real Resume APIs reject historical record without canonical workflow using memory only',async()=>{
  const tables={report_drafts:[{id,status:'approved',provider_id:'provider',deleted_at:null}],providers:[{id:'provider',is_active:true}],praktika_helper_jobs:[],mediref_helper_jobs:[]};
  assert.equal((await offlineGet('resume-mediref',tables,'synthetic')(id)).reason,'missing_workflow');
  assert.equal((await offlineGet('resume-workflow',tables,'synthetic')(id)).reason,'invalid_state');
  assert.equal((await offlineGet('retry-praktika',tables,'synthetic')(id)).eligible,false);
});
test('actual Retry Praktika GET recognizes failed linked upload without mutation',async()=>{
  const parent=continuationIntentId(id);
  const tables={report_drafts:[{id,status:'approved',provider_id:'provider',deleted_at:null,uploaded_to_praktika:false}],providers:[{id:'provider',is_active:true}],
    praktika_helper_jobs:[{id:parent,job_type:'complete_report_workflow',status:'failed',response:{stage:'upload'}},
      {id:'upload',job_type:'upload_report_to_praktika',status:'failed',request:{reportDraftId:id,continuationId:parent}}],mediref_helper_jobs:[]};
  const before=JSON.stringify(tables);
  assert.equal((await offlineGet('retry-praktika',tables,'synthetic')(id)).eligible,true);
  assert.equal(JSON.stringify(tables),before);
});
test('diagnostic outbound boundary permits only GET table reads; RPCs/actions blocked',()=>{
  const code=readFileSync('scripts/approved-recovery-audit.ts','utf8');
  assert.ok(code.includes("init?.method!=='GET'"));assert.ok(code.includes("throw new Error('rpc_forbidden')"));
  assert.ok(code.includes("throw new Error('action_forbidden')"));
  assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test('all providers run sequentially with isolated results and explicit failures',async()=>{
  const providers=Array.from({length:3},(_,i)=>({id:String(i),name:`Synthetic ${i}`,is_active:true}));
  let active=0,peak=0;const visited:string[]=[];
  const results=await auditSequentially(providers,async p=>{
    visited.push(p.id);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1));active--;
    if(p.id==='1')throw new Error('synthetic lookup failure');return {remaining:Number(p.id)};
  });
  assert.deepEqual(visited,['0','1','2']);assert.equal(peak,1);
  assert.equal(results[1].error,'provider_audit_incomplete');assert.equal(results[1].result,undefined);
  assert.equal(results[2].result?.remaining,2);
});
test('generic reasons use projected evidence and never claim a missing external artifact',()=>{
  const d=draft();d.workflow_resolved!.message='Workflow has not progressed. Review the unfinished workflow steps.';
  assert.equal(specificReason(d,checks,false),'MediRef delivery not confirmed.');
  d.workflow_resolved!.branches.mediref='completed';
  assert.equal(specificReason(d,checks,false),'Historical workflow evidence requires review.');
  assert.equal(specificReason(d,checks,true),null);
  assert.equal(specificReason(d,{...checks,workflow:{eligible:true}},true),'Periodontal continuation exhausted; safe read recovery is available.');
  assert.equal(specificReason(d,{...checks,workflow:{unavailable:true}},true),null);
});
test('incomplete eligibility stays unavailable regardless of raw completion flags',()=>{
  const d=draft();d.workflow_status='completed';d.workflow_mediref_status='completed';
  assert.equal(actionBucket(d,{...checks,mediref:{unavailable:true}},false),'unresolved_no_safe_action');
});
test('all-provider discovery filters active providers; diagnostic keeps page and request bounds',()=>{
  const code=readFileSync('scripts/approved-recovery-audit.ts','utf8');
  assert.ok(code.includes(".eq('is_active',true)"));assert.ok(code.includes('captureClient(env,45)'));
  assert.ok(code.includes(".eq('provider_id',provider.id)"));
  assert.ok(code.includes("if(page===1500)throw new Error('read_job_bound')"));
});
