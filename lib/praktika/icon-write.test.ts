import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPraktikaRequestId, praktikaIconFailure, praktikaIconFailureMessage, praktikaSessionId, redactPraktikaSessionId, withPraktikaRequestId } from './icon-write';

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
test('failure record keeps only the diagnostic categories, status and timing', () => {
  const diagnostic = { jobType: 'update_praktika_letter_icons', outcome: 'failed', stage: 'response_validation', requestInvoked: true,
    boundary: 'after_dispatch', httpStatus: 500, responseCategory: 'json', httpErrorCategory: 'internal_exception',
    requestDurationMs: 812, requestTimingEnd: 'response_received', failureCategory: 'http_error' };
  const failure = praktikaIconFailure(diagnostic);
  assert.deepEqual(failure, { failureCategory: 'http_error', stage: 'response_validation', httpStatus: 500, responseCategory: 'json', httpErrorCategory: 'internal_exception', requestDurationMs: 812 });
  assert.equal(praktikaIconFailureMessage(failure), 'Praktika icon update failed: HTTP 500, internal_exception, json reply. Outcome unconfirmed; reconcile before retrying.');
  assert.equal(praktikaIconFailureMessage(praktikaIconFailure({ failureCategory: 'request_timeout', stage: 'request_invoked' })),
    'Praktika icon update failed: request_timeout. Outcome unconfirmed; reconcile before retrying.');
  assert.deepEqual(praktikaIconFailure({}), { failureCategory: 'unknown' });
});
