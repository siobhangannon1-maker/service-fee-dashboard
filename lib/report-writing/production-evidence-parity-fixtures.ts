import { executionConflict, productionJobSettled, supportedResponseContainer } from './production-evidence';
import { allowedPraktikaRead, PERIO_READ_FIELDS, positivePraktikaReadId } from '../praktika/read-operations';
import type { ReadJob } from './resolved-workflow';

export const readIdBoundaries: unknown[] = ['123', '00123', 123, 0, '0', '000', -1, '-1', 1.5, '1.5', '123.0',
  ' 123', '123 ', '', null, true, {}, [], '12x', '+123', '1e3', '１２３', 9007199254740991,
  '9007199254740991', 9007199254740992, '9007199254740992', '0009007199254740991'];
export function readRequest(type: keyof typeof PERIO_READ_FIELDS, id: unknown = 123) {
  return { method: 'POST', path: '/php/forms/db_getFormData.php', contentType: 'json',
    body: [{ fields: [...PERIO_READ_FIELDS[type]], parameters: [{ practice_id: 1181,
      [type === 'periodontal_chart_perio_exams' ? 'perioexam_id' : 'patient_id']: id }] }] };
}
const icons = { appointment_icon1id: 6597, appointment_icon2id: 0, appointment_icon3id: 0, appointment_icon4id: 0 };
const iconRequest = { method: 'POST', path: '/php/forms/db_commitFormData.php', contentType: 'json',
  body: [{ practice_id: 1181, appointment_id: 456, ...icons }] };
const failure = { contract: 'mediref-no-job-failure-v1', insertionOutcome: 'not_attempted',
  externalExecution: 'not_started', deadlineExceeded: false, stage: 'pdf_generation', code: 'MEDIREF_PDF_GENERATION_FAILED' };
export function parityCases() {
  const cases: Array<{ name: string; job: ReadJob }> = [];
  const add = (name: string, job: ReadJob) => cases.push({ name, job });
  const containers: unknown[] = [undefined, null, {}, [], [{}], 'bad', 1, false, [null], [1], [[]],
    { rows: [{ externalExecution: 'uncertain' }] }, [{ externalExecution: 'uncertain' }],
    { externalExecution: 'not_started', rows: [{ externalExecution: 'uncertain' }] },
    { rows: [{ data: { deadlineExceeded: true } }] }];
  for (const key of ['requestInvoked', 'externalExecution', 'deadlineExceeded', 'dispatched', 'insertionOutcome',
    'uploadFailure', 'medirefPreparationFailure', 'manualWorkflowCompletion']) {
    for (const value of [null, false, true, 'false', 'not_started', 'not_attempted', 'unknown', [], {}, { unexpected: true }]) {
      containers.push({ [key]: value }, [{ [key]: value }], { rows: [{ [key]: value }] });
    }
  }
  const baseJobs: ReadJob[] = [
    ...Object.keys(PERIO_READ_FIELDS).map(type => ({ id: 'read', job_type: type, status: 'completed',
      request: readRequest(type as keyof typeof PERIO_READ_FIELDS) })),
    { id: 'upload', job_type: 'upload_report_to_praktika', status: 'completed', response: { patient_communication: { iFileId: 42 } } },
    { id: 'icon', job_type: 'update_praktika_letter_icons', status: 'completed', request: iconRequest, response: icons },
    { id: 'send', job_type: 'send_mediref_letter', status: 'completed', result: { prepared: true, sent: false } },
    { id: 'parent', job_type: 'complete_report_workflow', status: 'failed', response: { medirefPreparationFailure: failure } },
    { id: 'future', job_type: 'periodontal_future_writer', status: 'completed', response: { success: true } },
  ];
  for (const job of baseJobs) for (const [i, response] of containers.entries()) {
    add(`${job.job_type}/container/${i}`, { ...job, response, result: undefined });
    // A success receipt never conceals contradictory secondary retained evidence.
    add(`${job.job_type}/completion+container/${i}`, { ...job, result: response });
  }
  for (const type of Object.keys(PERIO_READ_FIELDS) as Array<keyof typeof PERIO_READ_FIELDS>) {
    for (const [i, id] of readIdBoundaries.entries()) for (const key of ['practice_id', type === 'periodontal_chart_perio_exams' ? 'perioexam_id' : 'patient_id']) {
      const q = readRequest(type); q.body[0].parameters[0][key] = id;
      add(`${type}/${key}/${i}`, { id: 'read', job_type: type, status: 'completed', request: q, response: [] });
    }
    for (const request of [null, {}, [], { ...readRequest(type), method: 'GET' }, { ...readRequest(type), body: [] },
      { ...readRequest(type), body: [{ fields: null, parameters: [] }] },
      { ...readRequest(type), body: [{ ...readRequest(type).body[0], extra: true }] }])
      add(`${type}/invalid-request/${JSON.stringify(request)}`, { id: 'read', job_type: type, status: 'completed', request: request as ReadJob['request'] });
  }
  for (const job of baseJobs) for (const status of ['pending', 'waiting', 'processing', 'running', 'failed', 'completed'])
    for (const lock of [false, true]) add(`${job.job_type}/${status}/lock/${lock}`, { ...job, status,
      ...(lock ? { locked_at: '2026-01-01', locked_by: 'retained' } : {}) });
  for (const response of [icons, { saved: true }, { ...icons, appointment_icon4id: null }, { ...icons, errors: [] },
    { ...icons, appointment_icon2id: 7360 }, { ...icons, success: false }])
    add(`icon/${JSON.stringify(response)}`, { ...baseJobs[3], response });
  return cases;
}
export function evaluateParityCases() {
  return parityCases().map(c => ({ ...c, expected: {
    read: allowedPraktikaRead(c.job.job_type, c.job.request), settled: productionJobSettled(c.job),
    responseConflict: executionConflict(c.job.response), resultConflict: executionConflict(c.job.result),
    responseContainer: supportedResponseContainer(c.job.response), resultContainer: supportedResponseContainer(c.job.result),
  } }));
}
if (process.argv.includes('--emit')) console.log(JSON.stringify({ cases: evaluateParityCases(),
  ids: readIdBoundaries.map(value => ({ value, expected: positivePraktikaReadId(value) })) }));
