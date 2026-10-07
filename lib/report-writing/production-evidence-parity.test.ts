import test from 'node:test';
import assert from 'node:assert/strict';
import { executionConflict, productionJobSettled } from './production-evidence';
import { positivePraktikaReadId, validatePraktikaRead } from '../praktika/read-operations';
import { readRequest } from './production-evidence-parity-fixtures';

test('object and array read evidence preserve nested uncertainty before receipt normalization', () => {
  const job = { id: 'read', job_type: 'periodontal_chart_perio_exams', status: 'completed', request: readRequest('periodontal_chart_perio_exams') };
  for (const response of [[{ externalExecution: 'uncertain' }], { rows: [{ externalExecution: 'uncertain' }] },
    { externalExecution: 'not_started', deep: [{ requestInvoked: true }] }]) assert.equal(productionJobSettled({ ...job, response }), false);
  for (const response of [null, {}, [], [{}]]) assert.equal(productionJobSettled({ ...job, response }), true);
  for (const response of ['bad', 1, false, [null], [1], [[]]]) assert.equal(productionJobSettled({ ...job, response }), false);
  assert.equal(productionJobSettled({ ...job, response: {}, result: [{ deadlineExceeded: true }] }), false);
});
test('malformed relevant diagnostics fail closed, ordinary nested read data remains valid', () => {
  for (const value of [{ dispatched: null }, { insertionOutcome: null }, { uploadFailure: [] }, { medirefPreparationFailure: false }]) assert.equal(executionConflict(value), true);
  assert.equal(executionConflict({ rows: [{ perioexam_id: 123, perioexam_toothdata: [{ tooth: 1 }] }] }), false);
});
test('canonical read IDs accept equivalent positive digit strings and safe integer numbers', () => {
  for (const id of ['123', '00123', 123, Number.MAX_SAFE_INTEGER, '0009007199254740991']) assert.equal(positivePraktikaReadId(id), true);
  for (const id of [0, -1, 1.5, '123.0', ' 123', '123 ', '', null, '12x', '+123', '1e3', Number.MAX_SAFE_INTEGER + 1]) assert.equal(positivePraktikaReadId(id), false);
  const request = readRequest('periodontal_chart_perio_exams', '00123');
  const response = [{ perioexam_id: 123, perioexam_patientid: 42, perioexam_date: '2026-01-01', perioexam_toothdata: [] }];
  assert.deepEqual(validatePraktikaRead('periodontal_chart_perio_exams', request, 200,
    'https://praktika.praktika.net.au/php/forms/db_getFormData.php', JSON.stringify(response)), response);
});
