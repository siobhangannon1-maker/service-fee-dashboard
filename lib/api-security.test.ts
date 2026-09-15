import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const secret = 'SENSITIVE_FIXTURE_NOT_FOR_LOGGING';
function authentication(mode: string, loggingThrows = false) {
  const logs: unknown[] = [], tables: string[] = [];
  const userClient = {
    auth: { getUser: async () => {
      if (mode === 'transport') throw new Error(secret);
      return { data: { user: mode === 'anonymous' ? null : { id: 'fixture-user', email: secret } }, error: mode === 'expired' ? { message: secret } : null };
    } },
    from: (table: string) => {
      tables.push(table);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { role: mode === 'wrong-role' ? 'typist' : 'admin' }, error: mode === 'role-error' ? secret : null,
      }) }) }) };
    },
  };
  const statusExports: Record<string, any> = {};
  runInNewContext(compile(readFileSync('lib/getUserStatus.ts', 'utf8')), {
    exports: statusExports, process: { env: {} }, console: { error: () => { throw new Error('Raw error logged'); } },
    require: () => ({ createClient: () => ({ from: (table: string) => {
      tables.push(table);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => {
        if (mode === 'status-throws') throw new Error(secret);
        return { data: mode === 'missing-status' ? null : { is_active: mode !== 'inactive' }, error: mode === 'status-error' ? secret : null };
      } }) }) };
    } }) }),
  });
  const exports: Record<string, any> = {};
  runInNewContext(compile(readFileSync('lib/auth.ts', 'utf8')), {
    exports, Response, console: { warn: (...args: unknown[]) => { logs.push(args); if (loggingThrows) throw new Error(secret); } },
    require: (name: string) => name === '@/lib/supabase/server' ? { createClient: async () => userClient }
      : name === '@/lib/getUserStatus' ? statusExports : {},
  });
  return { guard: exports.sensitiveApiAccess, logs, tables };
}
for (const [mode, expected] of Object.entries({ anonymous: 401, expired: 401, transport: 401,
  inactive: 403, 'status-error': 403, 'status-throws': 403, 'wrong-role': 403, 'role-error': 403,
  active: 0, 'missing-status': 0 })) {
  test(`shared active API guard: ${mode}`, async () => {
    const f = authentication(mode); const response = await f.guard('/api/fixture', ['admin', 'super_admin']);
    assert.equal(response?.status ?? 0, expected);
    assert.ok(!JSON.stringify(f.logs).includes(secret));
    if (response) assert.ok(!(await response.text()).includes(secret));
    if (expected === 401) assert.deepEqual(f.tables, []);
    assert.ok(f.tables.every(t => ['user_roles', 'user_status'].includes(t)));
  });
}
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const routes = walk('app/api').filter(p => p.endsWith('/route.ts') && readFileSync(p, 'utf8').includes('await sensitiveApiAccess('));
for (const path of routes) {
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const handlers = ast.statements.filter(ts.isFunctionDeclaration).filter(n => /^(GET|POST|PATCH|DELETE|PUT|handle)$/.test(n.name?.text || ''));
  for (const handler of handlers) {
    if (!handler.getText(ast).includes('await sensitiveApiAccess(')) continue;
    for (const [mode, status] of [['anonymous', 401], ['expired', 401], ['inactive', 403], ['status-error', 403], ...(handler.getText(ast).split('\n').find(line => line.includes('await sensitiveApiAccess('))?.includes(', [') ? [['wrong-role', 403] as const] : [])] as const) {
      test(`${path} ${handler.name!.text}: ${mode} denied before data access`, async () => {
        const f = authentication(mode);
        // No DB, storage, PDF, fetch or queue globals are provided: touching them
        // before denial is an immediate test failure. Execute the real handler body.
        const fn = runInNewContext(compile(handler.getText(ast).replace(/^export /, '')) + `\n${handler.name!.text}`, {
          sensitiveApiAccess: f.guard, currentWorkflowExecution: () => undefined,
        });
        const response = await fn(new Request('https://fixture.invalid', { method: 'POST', body: secret }));
        assert.equal(response.status, status);
        assert.ok(!(await response.text()).includes(secret));
      });
    }
  }
}
test('active authorized History access reaches the existing durable response', async () => {
  const source = readFileSync('app/api/report-writing/get-drafts/route.ts', 'utf8');
  const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'GET')!;
  const draft = { id: 'fixture', workflow_status: 'running' };
  const q: any = { select: () => q, is: () => q, order: () => q, then: (resolve: any) => resolve({ data: [draft], error: null }) };
  const run = runInNewContext(compile(fn.getText(ast).replace(/^export /, '')) + '\nGET', {
    sensitiveApiAccess: authentication('active').guard, URL, NextResponse: { json: Response.json },
    supabase: { from: () => q }, projectWorkflowRecovery: async (_db: unknown, drafts: unknown) => drafts,
  });
  const result = await run(new Request('https://fixture.invalid'));
  assert.equal(result.status, 200); assert.equal((await result.json()).drafts[0].id, 'fixture');
});
test('only existing in-process workflow context can bypass browser authentication', () => {
  const exceptions = routes.filter(p => readFileSync(p, 'utf8').includes('currentWorkflowExecution() ? null'));
  assert.deepEqual(exceptions.sort(), ['generate-pdf', 'send-via-mediref', 'update-praktika-letter-icons', 'upload-to-praktika'].map(r => `app/api/report-writing/${r}/route.ts`).sort());
  const context = readFileSync('lib/report-writing/workflow-execution-context.ts', 'utf8');
  assert.match(context, /AsyncLocalStorage/);
  for (const route of ['email-secure-pdf', 'send-via-mediref', 'upload-to-praktika']) {
    const source = readFileSync(`app/api/report-writing/${route}/route.ts`, 'utf8');
    assert.match(source, /await generateLetterPdf\(new Request\(/);
    assert.doesNotMatch(source, /await fetch\([\s\S]{0,100}\/generate-pdf/);
  }
});

test('security logging failure does not bypass or break denial', async () => {
  const result = await authentication('anonymous', true).guard('/api/fixture');
  assert.equal(result.status, 401);
});
test('browser-supplied continuation headers never bypass the route gate', async () => {
  const source = readFileSync('app/api/report-writing/generate-pdf/route.ts', 'utf8');
  const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'POST')!;
  const run = runInNewContext(compile(fn.getText(ast).replace(/^export /, '')) + '\nPOST', {
    sensitiveApiAccess: authentication('anonymous').guard, currentWorkflowExecution: () => undefined,
  });
  const result = await run(new Request('https://fixture.invalid', { method: 'POST', headers: {
    'X-Workflow-Token': 'forged', 'X-User-Id': 'fixture-user',
  }, body: '{}' }));
  assert.equal(result.status, 401);
});
