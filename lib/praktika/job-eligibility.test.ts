import assert from 'node:assert/strict';
import { test } from 'node:test';
import { praktikaJobEligibility } from './job-eligibility';
import { PERIO_READ_FIELDS, allowedPraktikaRead, validatePraktikaRead, verifiedReadOperation } from './read-operations';
const now = Date.now();
const live = { status: 'connected', helper_instance_id: 'generation', helper_heartbeat_at: new Date(now).toISOString(), authenticated_at: null };
const type = 'periodontal_chart_patient_perio_exam_ids';
const request = { method: 'POST', path: '/php/forms/db_getFormData.php', contentType: 'json', body: [{ parameters: [{ practice_id: 1181, patient_id: 123 }], fields: [...PERIO_READ_FIELDS[type]] }] };
const url = 'https://praktika.praktika.net.au/php/forms/db_getFormData.php';
for (const jobType of ['upload_report_to_praktika', 'update_praktika_letter_icons', 'add_clinical_note', 'unknown']) {
  test(`${jobType} uses browser availability without proof`, () => {
    assert.equal(allowedPraktikaRead(jobType, request), false);
    assert.equal(praktikaJobEligibility(live, jobType, request, now).eligible, true);
    assert.equal(praktikaJobEligibility({ ...live, authenticated_at: new Date(now).toISOString() }, jobType, request, now).eligible, true);
  });
}
for (const status of ['waiting_for_credentials', 'waiting_for_mfa', 'error', 'expired', 'refresh_requested']) {
  test(`${status} blocks reads and writes`, () => {
    assert.equal(praktikaJobEligibility({ ...live, status }, type, request, now).eligible, false);
  });
}
test('live rechecking allows explicit read without manufacturing proof', () => {
  const before = JSON.stringify(live);
  assert.deepEqual(praktikaJobEligibility(live, type, request, now), { eligible: true, readOnly: true });
  assert.deepEqual(validatePraktikaRead(type, request, 200, url, '{"patient_perioexamids":[1,2]}'), { patient_perioexamids: [1, 2] });
  assert.equal(JSON.stringify(live), before);
});
test('dead helper and login URL block read eligibility', () => {
  assert.equal(praktikaJobEligibility({ ...live, helper_instance_id: null }, type, request, now).eligible, false);
  assert.equal(praktikaJobEligibility({ ...live, current_url: 'https://praktika.praktika.net.au/v2/login' }, type, request, now).eligible, false);
});
for (const status of [307, 401, 403, 500]) {
  test(`${status} cannot validate read`, () => assert.throws(() => validatePraktikaRead(type, request, status, url, '{"patient_perioexamids":[]}')));
}
for (const data of ['<html>login</html>', '{"error":"private"}', '{"patient_perioexamids":["unsafe"]}', '{"patient_perioexamids":[],"login":true}', 'invalid']) {
  test('malformed/login/error read fails with fixed safe error', () => {
    assert.throws(() => validatePraktikaRead(type, request, 200, url, data), { message: 'Praktika read is temporarily unavailable.' });
  });
}
test('endpoint/body spoofing cannot enter read bypass', () => {
  assert.equal(allowedPraktikaRead(type, { ...request, path: '/php/forms/db_updateFormData.php' }), false);
  assert.equal(allowedPraktikaRead(type, { ...request, body: [{ ...request.body[0], fields: ['patient_communication'] }] }), false);
  assert.throws(() => validatePraktikaRead(type, request, 200, url + '?other', '{"patient_perioexamids":[]}'));
});
test('exam read validates requested identities and chart structure', () => {
  const examType = 'periodontal_chart_perio_exams';
  const examRequest = { ...request, body: [{ parameters: [{ practice_id: 1181, perioexam_id: 44 }], fields: [...PERIO_READ_FIELDS[examType]] }] };
  const exam = { perioexam_id: 44, perioexam_patientid: 123, perioexam_date: '2026-01-01', perioexam_toothdata: [] };
  assert.equal(allowedPraktikaRead(examType, examRequest), true);
  assert.deepEqual(validatePraktikaRead(examType, examRequest, 200, url, JSON.stringify([exam])), [exam]);
  assert.throws(() => validatePraktikaRead(examType, examRequest, 200, url, JSON.stringify([{ ...exam, perioexam_id: 45 }])));
  assert.throws(() => validatePraktikaRead(examType, examRequest, 200, url, '[]'));
});

test('existing proof-gated reads retain read classification but cannot disguise writes', () => {
  assert.equal(verifiedReadOperation('get_clinical_notes', { method: 'POST', path: '/php/forms/db_getFormData.php' }), true);
  assert.equal(verifiedReadOperation('get_clinical_notes', { method: 'POST', path: '/php/forms/db_commitFormData.php' }), false);
  assert.equal(allowedPraktikaRead('get_clinical_notes', request), false);
});
