import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
test('server workflow actor context is isolated between concurrent requests', async () => {
  const code = ts.transpileModule(readFileSync('lib/report-writing/workflow-execution-context.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const api = runInNewContext(code + '\nexports', { exports: {}, require: (name: string) => {
    if (name === 'server-only') return {};
    if (name === 'node:async_hooks') return { AsyncLocalStorage };
    throw new Error('Unexpected import');
  } });
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const first = api.withWorkflowExecution({ intentId: 'first', actor: { actorUserId: 'first-actor' } }, async () => {
    await waiting; assert.equal(api.currentWorkflowExecution().actor.actorUserId, 'first-actor');
  });
  await api.withWorkflowExecution({ intentId: 'second', actor: { actorUserId: 'second-actor' } }, async () => {
    assert.equal(api.currentWorkflowExecution().actor.actorUserId, 'second-actor');
  });
  assert.equal(api.currentWorkflowExecution(), undefined); resume(); await first;
  assert.equal(api.currentWorkflowExecution(), undefined);
});
