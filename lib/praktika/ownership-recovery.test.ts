import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPraktikaOwnershipRecovery } from './ownership-recovery';
import { PraktikaOwnershipLost, PraktikaOwnershipRejected, PraktikaOwnershipUnavailable, writePraktikaHelper } from './helper-lease';
import type { SupabaseClient } from '@supabase/supabase-js';

for (const kind of ['timeout', 'network', 'database']) test(`${kind}: pause dispatch, recover in place without closing browser`, async () => {
  let now = 0, calls = 0, dispatched = 0;
  const delays: number[] = [];
  const recovery = createPraktikaOwnershipRecovery({now: () => now, sleep: async ms => {
    assert.equal(dispatched, 0); delays.push(ms); now += ms;
  }});
  await recovery.run(async () => { if (++calls < 4) throw new PraktikaOwnershipUnavailable(); });
  dispatched++;
  assert.equal(dispatched, 1);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
test('unavailable past lease expires without dispatch; never retries an external write', async () => {
  let now = 0, dispatched = 0;
  const recovery = createPraktikaOwnershipRecovery({now: () => now, sleep: async ms => { now += ms; }});
  await assert.rejects(async () => {
    await recovery.run(async () => { throw new PraktikaOwnershipUnavailable(); }); dispatched++;
  }, PraktikaOwnershipLost);
  assert.equal(now, 90_000); assert.equal(dispatched, 0);
});
test('authoritative rejection is immediate and is not retried', async () => {
  let calls = 0;
  const recovery = createPraktikaOwnershipRecovery({sleep: async () => { assert.fail('must not back off'); }});
  await assert.rejects(recovery.run(async () => { calls++; throw new PraktikaOwnershipRejected(); }), PraktikaOwnershipRejected);
  assert.equal(calls, 1);
});
test('checks do not extend the lease, successful heartbeats do', async () => {
  let now = 0;
  const recovery = createPraktikaOwnershipRecovery({now: () => now});
  now = 80_000; await recovery.run(async () => true, true);
  now = 160_000; await recovery.run(async () => true);
  now = 170_000; await assert.rejects(recovery.run(async () => true), PraktikaOwnershipLost);
});
test('shutdown interrupts recovery without dispatch', async () => {
  let stopping = false;
  const recovery = createPraktikaOwnershipRecovery({stopping: () => stopping, sleep: async () => { stopping = true; }});
  await assert.rejects(recovery.run(async () => { throw new PraktikaOwnershipUnavailable(); }), PraktikaOwnershipLost);
});
for (const answer of ['true','false','null','error','throw']) test(`RPC ${answer} classified without raw error leakage`, async () => {
  const db = {rpc: () => ({abortSignal: async () => {
    if (answer === 'throw') throw new Error('private detail');
    return {data: answer === 'true' ? true : answer === 'false' ? false : null,
      error: answer === 'error' ? {message:'private detail'} : null};
  }})} as unknown as SupabaseClient;
  const work = writePraktikaHelper(db, 'session', 'generation', 'check');
  if (answer === 'true') await work;
  else await assert.rejects(work, error => {
    assert.ok(error instanceof (answer === 'false' ? PraktikaOwnershipRejected : PraktikaOwnershipUnavailable));
    assert.equal(String(error).includes('private detail'), false); return true;
  });
});

test('only identified infrastructure errors are recoverable, not configuration/challenges', async () => {
  const {isPraktikaTransientInfrastructureError: transient} = await import('./ownership-recovery');
  for (const name of ['TimeoutError', 'AbortError']) assert.equal(transient({name}), true);
  assert.equal(transient({code:'ECONNRESET'}), true);
  for (const message of ['Missing configuration', 'Credentials required', 'MFA required']) assert.equal(transient(new Error(message)), false);
});
