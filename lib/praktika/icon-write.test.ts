import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPraktikaRequestId, praktikaIconFailure, praktikaIconFailureMessage, praktikaSessionId, redactPraktikaSessionId, summarizePraktikaErrorBody, withPraktikaRequestId } from './icon-write';

test('request ids count up per session and restart for a new session', () => {
  assert.equal(nextPraktikaRequestId('abc'), 'abc_1');
  assert.equal(nextPraktikaRequestId('abc'), 'abc_2');
  assert.equal(nextPraktikaRequestId('def'), 'def_1');
});
test('session id comes only from PHPSESSID', () => {
  assert.equal(praktikaSessionId([{ name: 'UAT', value: 'x' }, { name: 'PHPSESSID', value: ' s1 ' }]), 's1');
  assert.equal(praktikaSessionId([{ name: 'UAT', value: 'x' }]), null);
  assert.equal(praktikaSessionId([{ name: 'PHPSESSID', value: '' }]), null);
});
test('request id is set on a copy of each row', () => {
  const body = [{ request_id: 'old', appointment_id: 1 }];
  assert.deepEqual(withPraktikaRequestId(body, 's_1'), [{ request_id: 's_1', appointment_id: 1 }]);
  assert.equal(body[0].request_id, 'old');
  assert.deepEqual(withPraktikaRequestId({}, 's_1'), {});
});
test('redaction removes the session id anywhere in a value', () => {
  assert.deepEqual(redactPraktikaSessionId({ a: 's9_1', b: [{ c: 'x s9 y' }] }, 's9'), { a: '[redacted]_1', b: [{ c: 'x [redacted] y' }] });
  const same = { a: 1 }; assert.equal(redactPraktikaSessionId(same, 's9'), same);
  assert.equal(redactPraktikaSessionId(same, null), same);
});
test('error body summary keeps categories only', () => {
  assert.deepEqual(summarizePraktikaErrorBody(''), { bodyType: 'empty', errorCategory: 'none' });
  assert.deepEqual(summarizePraktikaErrorBody('<html>Internal Server Error</html>'), { bodyType: 'html', errorCategory: 'internal_exception' });
  assert.deepEqual(summarizePraktikaErrorBody('{"error":"DBUnauthorisedException"}'), { bodyType: 'json', errorCategory: 'authentication', exceptionName: 'DBUnauthorisedException' });
  assert.deepEqual(summarizePraktikaErrorBody('{"error":"ValidationException: invalid icon id"}'), { bodyType: 'json', errorCategory: 'validation', exceptionName: 'ValidationException' });
  const s = summarizePraktikaErrorBody('Something odd for patient Jane Citizen');
  assert.deepEqual(s, { bodyType: 'text', errorCategory: 'other' });
});
test('failure categories and message', () => {
  const http = praktikaIconFailure(Object.assign(new Error('x'), { praktikaHttpStatus: 500, praktikaBodySummary: { bodyType: 'json', errorCategory: 'other' } }));
  assert.deepEqual(http, { failureCategory: 'http_error', httpStatus: 500, bodyType: 'json', errorCategory: 'other' });
  assert.equal(praktikaIconFailureMessage(http), 'Praktika icon update failed: HTTP 500, other. Outcome unconfirmed; reconcile before retrying.');
  assert.equal(praktikaIconFailure(Object.assign(new Error('x'), { name: 'TimeoutError' })).failureCategory, 'request_timeout');
  assert.equal(praktikaIconFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' })).failureCategory, 'transport_failure');
  assert.equal(praktikaIconFailure(new Error('Praktika helper returned non-JSON: secret')).failureCategory, 'response_validation_failure');
  assert.equal(praktikaIconFailureMessage({ failureCategory: 'request_timeout' }), 'Praktika icon update failed: request_timeout. Outcome unconfirmed; reconcile before retrying.');
});
