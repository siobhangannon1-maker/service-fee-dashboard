import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Explicit policy inventory: a future guard edit must not silently restore
// active-user-only access to practice-wide financial data or mutations.
const groupARoutes = ['run-xero-upload-benchmark-flow', 'xero-benchmark-report', 'test-xero-mapping', 'xero-benchmark-reports', 'expense-benchmark-report', 'expense-benchmark-check', 'xero-account-mappings', 'monthly-gross-production', 'xero-imports', 'xero-imports/upload', 'xero-imports/link', 'xero-imports/unlink', 'xero-imports/delete', 'xero/list-contacts', 'xero/test-connection', 'xero/labour-hire-sync', 'xero/sync-profit-and-loss', 'xero/debug-accounts', 'xero/process-profit-and-loss', 'xero/list-tenants', 'xero/debug-labour-hire', 'praktika/production-sync'];
for (const route of groupARoutes) test(`financial policy is active Group A: ${route}`, () => {
  const path = `app/api/${route}/route.ts`;
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const handlers = source.statements.filter(ts.isFunctionDeclaration)
    .filter(node => /^(GET|POST|DELETE|PATCH|PUT)$/.test(node.name?.text || ''));
  assert.ok(handlers.length);
  for (const handler of handlers) {
    const first = handler.body!.statements[0];
    assert.ok(ts.isVariableStatement(first));
    const expression = first.declarationList.declarations[0].initializer!;
    assert.ok(ts.isAwaitExpression(expression));
    assert.ok(ts.isCallExpression(expression.expression));
    const call = expression.expression;
    assert.equal(call.expression.getText(source), 'sensitiveApiAccess');
    assert.equal(call.arguments[0].getText(source), JSON.stringify('/api/' + route));
    assert.deepEqual(JSON.parse(call.arguments[1].getText(source)), ['admin', 'super_admin']);
    assert.match(handler.body!.statements[1].getText(source), /if \(accessDenied\) return accessDenied/);
  }
});
for (const route of ['billing-periods', 'benchmarks']) test(`shared low-risk GET stays active-user only: ${route}`, () => {
  const source = readFileSync(`app/api/${route}/route.ts`, 'utf8');
  assert.match(source, new RegExp('sensitiveApiAccess\\("/api/' + route + '"\\)'));
});
test('payroll import preserves the exact owner-approved manager/admin boundary', () => {
  const source = readFileSync('app/api/connecteam/payroll-totals/import/route.ts', 'utf8');
  assert.ok(source.includes('sensitiveApiAccess("/api/connecteam/payroll-totals/import", ["admin", "super_admin", "practice_manager"])'));
});

// Execute real guards and route bodies with synthetic Auth/DB boundaries only.
// No network, service-role client, or payroll processor is available to denial tests.
import { runInNewContext } from 'node:vm';
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
function guardFor(role: string, state = 'active') {
  const statusExports: Record<string, any> = {};
  runInNewContext(compile(readFileSync('lib/getUserStatus.ts', 'utf8')), {
    exports: statusExports, process: { env: {} },
    require: () => ({ createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: { is_active: state !== 'inactive' }, error: null }),
    }) }) }) }) }),
  });
  const exports: Record<string, any> = {};
  runInNewContext(compile(readFileSync('lib/auth.ts', 'utf8')), {
    exports, Response, console: { warn() {} },
    require: (name: string) => name === '@/lib/getUserStatus' ? statusExports : {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: state === 'anonymous' ? null : { id: 'synthetic' } }, error: state === 'expired' ? new Error('private') : null }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) }),
      }),
    },
  });
  return exports.sensitiveApiAccess;
}
function handlers(route: string) {
  const source = ts.createSourceFile('route.ts', readFileSync(`app/api/${route}/route.ts`, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.filter(ts.isFunctionDeclaration).filter(n => /^(GET|POST|DELETE|PATCH|PUT)$/.test(n.name?.text || '')).map(n => ({ name: n.name!.text, text: n.getText(source).replace(/^export /, '') }));
}
function execute(handler: { name: string; text: string }, role: string, state: string, extras = {}) {
  return runInNewContext(compile(handler.text) + `\n${handler.name}`, {
    sensitiveApiAccess: guardFor(role, state), ...extras,
  });
}
const deniedCases = [ ['admin', 'anonymous', 401], ['admin', 'expired', 401], ['admin', 'inactive', 403],
  ...['billing_staff', 'staff', 'practice_manager', 'provider_readonly', 'typist'].map(role => [role, 'active', 403]),
] as const;
for (const route of groupARoutes) for (const handler of handlers(route)) for (const [role, state, status] of deniedCases) {
  test(`closeout ${route} ${handler.name}: ${state} ${role} denied before processing`, async () => {
    let bodyReads = 0;
    const request = { json() { bodyReads++; throw new Error('Processing started'); }, formData() { bodyReads++; throw new Error('Processing started'); } };
    const response = await execute(handler, String(role), String(state))(request);
    assert.equal(response.status, status);
    assert.equal(bodyReads, 0);
  });
}
const payroll = handlers('connecteam/payroll-totals/import')[0];
for (const [role, state, expected] of [
  ['practice_manager', 'anonymous', 401], ['practice_manager', 'expired', 401], ['practice_manager', 'inactive', 403],
  ...['admin', 'super_admin', 'practice_manager'].map(role => [role, 'active', 400]),
  ...['billing_staff', 'staff', 'provider_readonly', 'typist'].map(role => [role, 'active', 403]),
]) test(`payroll boundary: ${state} ${role}`, async () => {
  let bodyReads = 0, mutations = 0;
  const response = await execute(payroll, String(role), String(state), {
    NextResponse: { json: Response.json },
    createClient() { mutations++; throw new Error('Payroll must not start'); },
  })({ formData: async () => { bodyReads++; return new FormData(); } });
  assert.equal(response.status, expected);
  assert.equal(bodyReads, expected === 400 ? 1 : 0);
  assert.equal(mutations, 0);
  if (expected === 400) assert.equal((await response.json()).error, 'No CSV file uploaded');
});
for (const role of ['admin', 'super_admin']) for (const [route, method, status] of [
  ['xero-benchmark-report', 'POST', 400], ['xero-imports/upload', 'POST', 400],
  ['xero-account-mappings', 'GET', 200], ['xero/list-contacts', 'GET', 200],
  ['xero/debug-accounts', 'GET', 200], ['monthly-gross-production', 'POST', 400],
  ['praktika/production-sync', 'POST', 500],
] as const) test(`authorized ${role} reaches safe handler: ${route}`, async () => {
  const handler = handlers(route).find(h => h.name === method)!;
  const response = await execute(handler, role, 'active', {
    NextResponse: { json: Response.json }, console: { error() {} },
    supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) },
    xeroFetch: async () => ({ Contacts: [] }), getXeroAccessToken: async () => 'synthetic',
    fetch: async () => ({ json: async () => ({ Invoices: [] }) }),
    getCurrentUserPraktikaSessionMode: async () => 'synthetic',
  })({ json: async () => ({}), formData: async () => new FormData() });
  assert.equal(response.status, status);
  // This route's existing missing-input contract is 500; no external action runs.
  if (route === 'praktika/production-sync') assert.equal((await response.json()).error, 'Missing billing period.');
});
