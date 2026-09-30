import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const secret = 'SENSITIVE_FIXTURE';
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
class ApiAuthorizationError extends Error { constructor(public status: number) { super(secret); } }
function fixture(role = 'provider_readonly', mode = 'active', itemProvider = B, generationStatus = 200) {
  const mutations: { table: string; operation: string; filters: Record<string, unknown>; payload: unknown }[] = [];
  const logs: unknown[] = [];
  const generations: unknown[] = [];
  const reads: string[] = [];
  const db = { from(table: string) {
    reads.push(table);
    const filters: Record<string, unknown> = {};
    let operation = 'select', payload: unknown;
    const result = () => {
      if (operation !== 'select') mutations.push({ table, operation, filters, payload });
      if (table === 'user_status') return {error: null, data: mode === 'missing-status' ? null : {is_active: mode === 'null-status' ? null : true}};
      if (table === 'providers') return { error: mode === 'provider-error' ? secret : null,
        data: mode === 'inactive-provider' || mode === 'missing-provider' ? null :
          !filters.id ? [{id:A,name:'Synthetic A'},{id:B,name:'Synthetic B'}] : { id: filters.id, user_id: filters.id === A && mode !== 'no-provider' && mode !== 'email-only' ? 'actor' : 'other' } };
      return { error: mode === 'item-error' ? secret : null,
        data: operation === 'select' && filters.id ? { id: ITEM, provider_id: itemProvider } : [] };
    };
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      in: () => q, order: () => q, limit: () => q,
      insert: (v: unknown) => { operation = 'insert'; payload = v; return q; },
      upsert: (v: unknown) => { operation = 'upsert'; payload = v; return q; },
      update: (v: unknown) => { operation = 'update'; payload = v; return q; },
      delete: () => { operation = 'delete'; return q; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  const roles = { from(table: string) {
    assert.equal(table, 'user_roles');
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: mode === 'missing-role' ? null : { role }, error: mode === 'role-error' ? secret : null,
    }) }) }) };
  } };
  const helper: Record<string, any> = {};
  runInNewContext(compile(readFileSync('lib/report-writing/training-authorization.ts', 'utf8')), {
    exports: helper, Response, console: { warn: (...x: unknown[]) => logs.push(x), error: (...x: unknown[]) => logs.push(x) },
    require: (name: string) => name === '@/lib/auth' ? { ApiAuthorizationError, requireActiveApiUser: async () => {
      if (['anonymous','expired'].includes(mode)) throw new ApiAuthorizationError(401);
      if (['inactive','status-error'].includes(mode)) throw new ApiAuthorizationError(403);
      return { user: { id: 'actor', email: secret, user_metadata: { role: 'super_admin' } }, supabase: roles };
    } } : name === '@/lib/supabase/admin' ? { supabaseAdmin: db } : {},
  });
  function route(path: string) {
    const exports: Record<string, any> = {};
    runInNewContext(compile(readFileSync(`app/api/report-writing/${path}/route.ts`, 'utf8')), {
      exports, Response, Request, URL, process: { env: { OPENAI_API_KEY: 'synthetic', NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' } },
      console: { warn: (...x: unknown[]) => logs.push(x), error: (...x: unknown[]) => logs.push(x) },
      require: (name: string) => name === '@/lib/report-writing/training-authorization' ? helper
        : name === 'next/server' ? { NextResponse: Response }
        : name === '@supabase/supabase-js' ? { createClient: () => db }
        : name === 'openai' ? class { chat = { completions: { create: async () => ({ choices: [{message:{content:'{}'}}] }) } }; }
        : name === '@/lib/report-writing/training-generation' ? { generateTrainingLetter: async (_request: Request, payload: unknown) => { generations.push(payload); if (generationStatus !== 200) throw new ApiAuthorizationError(generationStatus); return 'Synthetic report'; }, trainingGenerationErrorResponse: (error: unknown) => error instanceof ApiAuthorizationError ? Response.json({success:false,error:'Access denied.'},{status:error.status}) : null } : {},
    });
    return exports;
  }
  return { helper, route, mutations, reads, logs, generations };
}

for (const mode of ['anonymous','expired','inactive','status-error','missing-role','role-error']) {
  test(`training identity fails safely: ${mode}`, async () => {
    const f = fixture('typist', mode);
    for (const cross of [false, true]) {
      const r = await f.helper.trainingAccess(cross);
      assert.equal(r.denied.status, ['anonymous','expired'].includes(mode) ? 401 : 403);
      assert.ok(!(await r.denied.text()).includes(secret));
    }
    assert.equal(f.mutations.length, 0);
    assert.ok(f.reads.every(table => table === 'user_status'));
  });
}
for (const role of ['provider_readonly','typist','practice_manager','admin','super_admin']) {
  test(`canonical ${role} ownership/capability is independent of provider identity`, async () => {
    const f = fixture(role); const actor = (await f.helper.trainingAccess()).value;
    assert.equal(await f.helper.trainingProviderAccess(actor, A), null);
    for (const target of [B,C]) assert.equal((await f.helper.trainingProviderAccess(actor,target))?.status ?? 200, role === 'provider_readonly' ? 403 : 200);
    assert.equal((await f.helper.trainingAccess(true)).denied?.status ?? 200, role === 'provider_readonly' ? 403 : 200);
  });
}
for (const role of ['typist','practice_manager','admin','super_admin']) {
  test(`${role} without provider identity can train active providers`, async () => {
    const f=fixture(role,'no-provider'); const actor=(await f.helper.trainingAccess()).value;
    for (const target of [A,B]) assert.equal(await f.helper.trainingProviderAccess(actor,target),null);
  });
}
for (const mode of ['inactive-provider','missing-provider','provider-error','email-only']) {
  test(`target fails safely: ${mode}`, async () => {
    const f=fixture('provider_readonly',mode);const actor=(await f.helper.trainingAccess()).value;
    assert.equal((await f.helper.trainingProviderAccess(actor,A)).status,mode==='provider-error'?503:403);
  });
}
test('profile, metadata and browser flags cannot grant cross-provider capability', async () => {
  const f=fixture('provider_readonly');const actor=(await f.helper.trainingAccess()).value;
  assert.equal(actor.canTrainAcrossProviders,false);
  const r=await f.route('provider-training').POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({providerId:B,type:'example',exampleText:secret,role:'admin',canTrainAcrossProviders:true})}));
  assert.equal(r.status,403);assert.equal(f.mutations.length,0);assert.ok(!JSON.stringify(f.logs).includes(secret));
  assert.ok(!readFileSync('lib/report-writing/training-authorization.ts','utf8').includes('.from("profiles")'));
});

const targets = ['provider-training','provider-report-type-settings','provider-knowledge','provider-training-cases',
  'provider-training-cases/analyze-provider','provider-training-cases/train-provider-knowledge',
  'provider-training-cases/train-loop','provider-training-cases/train-provider-behaviours',
  'admin/provider-examples','admin/auto-tag-provider-examples'];
const deletes = [
  ['provider-training/delete',{type:'example',id:ITEM}],
  ['provider-training/delete',{type:'rule',id:ITEM}],
  ['provider-training/delete',{type:'terminology',id:ITEM}],
  ['provider-training/delete',{type:'edit_example',id:ITEM}],
  ['provider-knowledge/delete',{id:ITEM}],
  ['provider-training-cases/delete',{id:ITEM}],
  ['admin/provider-examples/delete',{exampleId:ITEM}],
] as const;
for (const path of [...targets,...new Set(deletes.map(([p])=>p))]) {
  for (const mode of ['anonymous','expired','inactive','status-error']) test(`${path}: ${mode} denied before training access`,async()=>{
    const f=fixture('typist',mode);const handlers=f.route(path);
    for(const method of ['GET','POST']) if(handlers[method]){
      const r=await handlers[method](new Request('https://fixture.invalid?providerId='+B,{method,...(method==='POST'?{body:JSON.stringify({providerId:B,exampleText:secret})}:{})}));
      assert.equal(r.status,mode==='anonymous'||mode==='expired'?401:403);
      assert.ok(!(await r.text()).includes(secret));
    }
    assert.equal(f.mutations.length,0);assert.equal(f.reads.length,0);
  });
}
for (const path of targets) test(`${path}: ordinary provider cannot use foreign providerId`,async()=>{
  const f=fixture();const handlers=f.route(path);
  for(const method of ['GET','POST'])if(handlers[method]){
    const r=await handlers[method](new Request('https://fixture.invalid?providerId='+B,{method,...(method==='POST'?{body:JSON.stringify({providerId:B,reportType:'review',exampleText:secret})}:{})}));
    assert.equal(r.status,403);
  }
  assert.equal(f.mutations.length,0);
});
for(const [path,body] of deletes) test(`${path} ${'type' in body?body.type:''}: stored ownership controls mutation`,async()=>{
  const denied=fixture();const r=await denied.route(path).POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({...body,providerId:A})}));
  assert.equal(r.status,403);assert.equal(denied.mutations.length,0);
  const allowed=fixture('typist');const ok=await allowed.route(path).POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)}));
  assert.equal(ok.status,200);assert.equal(allowed.mutations.length,1);
  assert.equal(allowed.mutations[0].filters.provider_id,B);
});
for(const role of ['provider_readonly','typist','practice_manager','admin','super_admin'])test(`manual Add Example and read: ${role}`,async()=>{
  const f=fixture(role);const target=role==='provider_readonly'?A:B;const route=f.route('provider-training');
  const read=await route.GET(new Request('https://fixture.invalid?providerId='+target));assert.equal(read.status,200);
  const response=await route.POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({providerId:target,type:'example',exampleText:'Synthetic example',reportType:'review',title:'Synthetic'})}));
  assert.equal(response.status,200);assert.equal(f.mutations.length,1);assert.equal((f.mutations[0].payload as {provider_id:string}).provider_id,target);
});

for (const path of ['train-provider-knowledge','train-loop','train-provider-behaviours']) {
 for (const role of ['provider_readonly','typist']) test(`${path}: legitimate ${role} reaches generation and saves training`,async()=>{
  const f=fixture(role);const providerId=role==='provider_readonly'?A:B;
  const r=await f.route('provider-training-cases/'+path).POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({providerId,reportType:'review',patientFirstName:'Synthetic',clinicalNotes:'Synthetic notes',idealLetter:'Synthetic letter',maxAttempts:2,regeneratePreview:true})}));
  assert.equal(r.status,200,await r.clone().text());assert.ok(f.generations.length>0);assert.ok(f.mutations.length>0);
 });
 for (const status of [401,403]) test(`${path}: inner ${status} propagates safely before training writes`,async()=>{
  const f=fixture('provider_readonly','active',B,status);
  const r=await f.route('provider-training-cases/'+path).POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({providerId:A,reportType:'review',patientFirstName:'Synthetic',clinicalNotes:'Synthetic notes',idealLetter:'Synthetic letter'})}));
  assert.equal(r.status,status);assert.equal(f.mutations.length,0);assert.equal(f.generations.length,1);assert.ok(!JSON.stringify(f.logs).includes(secret));
 });
}

for(const mode of ['missing-status','null-status'])test(`${mode} cannot inherit legacy active-account compatibility`,async()=>{
 const f=fixture('typist',mode);assert.equal((await f.helper.trainingAccess()).denied.status,403);assert.equal(f.mutations.length,0);
});
test('unknown canonical role is denied even for a linked provider',async()=>{
 const f=fixture('unknown');assert.equal((await f.helper.trainingAccess()).denied.status,403);
});

for (const role of ['typist','practice_manager','admin','super_admin']) test(`cross-provider list allowed for ${role}`,async()=>{
 const f=fixture(role);const r=await f.route('admin/provider-examples').GET();assert.equal(r.status,200);const body=await r.json();assert.equal(body.providers.length,2);assert.equal(f.mutations.length,0);
});
for(const [path,body] of deletes.filter(([p])=>!p.startsWith('admin/')))test(`${path} own item allowed for ordinary provider`,async()=>{
 const f=fixture('provider_readonly','active',A);const r=await f.route(path).POST(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)}));assert.equal(r.status,200);assert.equal(f.mutations.length,1);assert.equal(f.mutations[0].filters.provider_id,A);
});
