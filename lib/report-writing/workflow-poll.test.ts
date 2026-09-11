import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { continuationToken } from './workflow-continuation-token';
const path = 'scripts/praktika-workflow-continuations.ts';
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'pollPraktikaWorkflowContinuations')!;
const code = ts.transpileModule(fn.getText(source).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
test('continuation HTTP runs alongside helper drain, not blocking its child jobs', async () => {
  let requests = 0; let finish!: (response: Response) => void;
  const inFlight = new Set<string>();
  const query: any = { select: () => query, eq: () => query, or: () => query, order: () => query, limit: () => query,
    abortSignal: async () => ({ data: [{ id: 'intent', status: 'waiting', updated_at: 'fixture', response: { stage: 'upload' } }] }),
    update: () => query, maybeSingle: async () => ({ data: { id: 'intent' } }),
  };
  const poll = runInNewContext(code + '\npollPraktikaWorkflowContinuations', {
    workflowConfigurationIssue: () => null, workflowAppOrigin: () => 'https://fixture.invalid', isUserPraktikaReady: async () => { throw new Error('global proof must not gate independent dispatch'); }, inFlight, Date, AbortSignal,
    randomUUID: () => 'lock', continuationToken, process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'synthetic' } },
    fetch: (_url: string, options: RequestInit) => {
      requests++; assert.equal(options.redirect, 'error');
      return new Promise<Response>(resolve => { finish = resolve; });
    },
  });
  const ownership = { assertOwned: async () => {}, isShuttingDown: () => false };
  await poll({ from: () => query }, 'actor', ownership);
  assert.equal(requests, 1); assert.equal(inFlight.has('actor'), true);
  await poll({ from: () => query }, 'actor', ownership); assert.equal(requests, 1);
  finish(Response.json({ success: true })); await new Promise(resolve => setImmediate(resolve));
  assert.equal(inFlight.size, 0);
});

test('worker configuration failures are durably actionable, including rejected signatures', async () => {
  for (const mode of ['missing', 'mismatch', 'matched', 'transport']) {
    const patches: any[] = [];
    const query: any = { select: () => query, eq: () => query, or: () => query, order: () => query, limit: () => query,
      abortSignal: async () => ({ data: [{ id:'intent',status:'waiting',updated_at:'fixture',response:{stage:'upload'} }] }),
      update: (patch: any) => { patches.push(patch); return query; }, maybeSingle: async () => ({data:{id:'intent'}}),
      then: (resolve: (v: unknown) => void) => Promise.resolve({error:null}).then(resolve),
    };
    const poll = runInNewContext(code + '\npollPraktikaWorkflowContinuations', {
      workflowConfigurationIssue: () => mode === 'missing' ? 'configuration_unavailable' : null,
      workflowAppOrigin: () => mode === 'missing' ? null : 'https://fixture.invalid', isUserPraktikaReady: async()=>true,
      inFlight:new Set(), Date, AbortSignal, randomUUID:()=> 'lock',continuationToken,
      process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic'}},
      fetch: async()=>{assert.notEqual(mode,'missing');return Response.json({}, {status:mode==='mismatch'?403:mode==='transport'?503:200});},
    });
    await poll({from:()=>query},'actor',{assertOwned:async()=>{},isShuttingDown:()=>false});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(patches.some(p=>p.response?.issue==='configuration_unavailable'),['missing','mismatch'].includes(mode));
    if(['missing','mismatch'].includes(mode))assert.equal(patches.at(-1).status,'waiting');
    if(mode==='transport'){ assert.equal(patches.at(-1).response.issue,'continuation_unavailable'); assert.equal(patches.at(-1).status,undefined); assert.equal(patches.at(-1).locked_at,undefined); }
    assert.doesNotMatch(JSON.stringify(patches),/synthetic|fixture.invalid/);
  }
});
