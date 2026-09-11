import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { workflowAccountState, projectWorkflowRecovery, workflowConfigurationMessage } from './workflow-recovery';
import { workflowConfigurationIssue, continuationToken, validContinuationToken, continuationIntentId } from './workflow-continuation-token';
import { sameIconHelperTarget } from '../praktika/icon-helper-target';
for (const outcome of ['active','inactive','error','throw','missing']) test(`account ${outcome} is classified without leaking errors`, async () => {
  const db = { from() { const q: any = { select: () => q, eq: () => q, abortSignal: () => q, maybeSingle: async () => {
    if (outcome === 'throw') throw Error('PRIVATE');
    return { data: outcome === 'missing' ? null : { is_active: outcome === 'active' }, error: outcome === 'error' ? { message: 'PRIVATE' } : null };
  } }; return q; } };
  assert.equal(await workflowAccountState(db as any, 'actor'), ['active','inactive'].includes(outcome) ? outcome : 'unavailable');
});
const request = (id?: number) => ({ method: 'POST', path: '/php/forms/db_commitFormData.php', contentType: 'json', body: [{ practice_id: 1181, appointment_id: id }] });
test('icon reuse requires the same proven practice/appointment', () => {
  assert.equal(sameIconHelperTarget(request(12), request(12)), true);
  assert.equal(sameIconHelperTarget(request(12), request(13)), false);
  assert.equal(sameIconHelperTarget(request(), request(12)), false);
  assert.equal(sameIconHelperTarget(request(12), request()), false);
  assert.match(readFileSync('lib/praktika/helper-jobs.ts','utf8'), /!sameIconHelperTarget\(existing.data.request, request\)/);
});
test('configuration requires HTTPS origin and signing material; matched tokens only', () => {
  const keys = ['NEXT_PUBLIC_APP_URL','NEXT_PUBLIC_SITE_URL','SUPABASE_SERVICE_ROLE_KEY'];
  const before = keys.map(k => process.env[k]);
  try {
    keys.forEach(k => delete process.env[k]);
    assert.equal(workflowConfigurationIssue(), 'configuration_unavailable');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'; process.env.NEXT_PUBLIC_APP_URL = 'http://fixture.invalid';
    assert.equal(workflowConfigurationIssue(), 'configuration_unavailable');
    process.env.NEXT_PUBLIC_APP_URL = 'https://fixture.invalid'; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(workflowConfigurationIssue(), 'configuration_unavailable');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'; assert.equal(workflowConfigurationIssue(), null);
    const token = continuationToken('intent','lock','synthetic');
    assert.equal(validContinuationToken(token,'intent','lock','synthetic'), true);
    assert.equal(validContinuationToken(token,'intent','lock','different'), false);
  } finally { keys.forEach((k,i) => { if (before[i] === undefined) delete process.env[k]; else process.env[k] = before[i]; }); }
});
test('configuration problem and absent dispatch surface safe actionable state on refresh', async () => {
  for (const issue of ['configuration_unavailable', undefined]) {
    const db = { from() { const q: any = { select:()=>q,eq:()=>q,in:()=>q,abortSignal:async()=>({data:[{
      id:continuationIntentId('draft'),status:'waiting',response:{issue},updated_at:new Date(0).toISOString(),
    }],error:null}) };return q;} };
    const [draft] = await projectWorkflowRecovery(db as any,[{id:'draft',workflow_status:'running',workflow_last_message:''}]);
    assert.match(draft.workflow_last_message, /administrator/);
    if (issue) assert.equal(draft.workflow_last_message,workflowConfigurationMessage);
  }
});
test('helper insertion conflict reuses only the same icon target', async () => {
  const ts = await import('typescript'); const { runInNewContext } = await import('node:vm');
  const path = 'lib/praktika/helper-jobs.ts'; const ast = ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  const fn = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createPraktikaHelperJob')!;
  const code = ts.transpileModule(fn.getText(ast).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for (const target of [12,13,undefined]) {
    let inserted=false;
    const q:any={insert:()=>{inserted=true;return q;},select:()=>q,eq:()=>q,single:async()=>{
      if(inserted){inserted=false;return {error:{code:'23505'},data:null};}
      return {error:null,data:{id:'existing',request:request(target)}};
    }};
    const create=runInNewContext(code+'\ncreatePraktikaHelperJob',{
      currentWorkflowExecution:()=>({intentId:'intent'}),continuationChildId:()=> 'existing',supabaseAdmin:{from:()=>q},sameIconHelperTarget,Date,
    });
    const call=create({appUserId:'actor',jobType:'update_praktika_letter_icons',request:request(12)});
    if(target===12)assert.equal((await call).id,'existing');
    else await assert.rejects(call,/target could not be reconciled/);
  }
});
