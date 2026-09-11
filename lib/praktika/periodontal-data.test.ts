import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { selectPeriodontalData } from './periodontal-data';
const path = 'lib/praktika/periodontal-chart.ts';
const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'generatePeriodontalChartPdf')!;
const code = ts.transpileModule(fn.getText(ast).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const exam = { perioexam_id: 1, perioexam_patientid: 123, perioexam_date: '2026-01-01', perioexam_toothdata: [] };
function chart(live: () => Promise<unknown[]>) {
  return runInNewContext(code + '\ngeneratePeriodontalChartPdf', {
    selectPeriodontalData, getPatientPerioExamIds: live, getPerioExams: async () => [exam],
    pickExamForDate: (rows: unknown[]) => rows[0], normaliseDate: (value: string) => value,
    renderPerioChartPdf: async () => Buffer.from('synthetic-pdf'), safeFileName: () => 'synthetic',
  });
}
test('explicit cached chart renders while live retrieval is unavailable', async () => {
  const result = await chart(async () => assert.fail('cached rendering must not request Praktika'))({ patientId: 123, freshness: 'cached', cachedExams: [exam] });
  assert.equal(result.examId, 1);
});
test('fresh-required chart never substitutes cached data after read failure', async () => {
  await assert.rejects(chart(async () => { throw new Error('temporary unavailable'); })({ patientId: 123, freshness: 'live', cachedExams: [exam] }), /temporary unavailable/);
});
test('default remains live and cached data from another patient is rejected', async () => {
  let calls = 0;
  await chart(async () => { calls++; return [1]; })({ patientId: 123 }); assert.equal(calls, 1);
  await assert.rejects(chart(async () => [])({ patientId: 999, freshness: 'cached', cachedExams: [exam] }), /does not match/);
});
