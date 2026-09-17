// Paste this entire expression into the normal app's browser console as admin.
// One explicit run, no polling, retries, worker or external requests.
(async () => {
  const digest = 'caeb542145f38be0deb380c115745bde5e6ab394434933f5282288e851ade5af';
  const endpoint = '/api/report-writing/historical-attention';
  const key = `historical-attention:${digest}`;
  if (!navigator.locks) throw new Error('STOP: Web Locks required for single-tab execution.');
  return navigator.locks.request(key, { ifAvailable: true }, async lock => {
  if (!lock) throw new Error('STOP: another controller is active.');
  if (localStorage.getItem(key)) throw new Error('STOP: a journal exists. Review it before any further execution.');
  const journal = { cohortDigest: digest, status: 'started', entries: [] };
  const save = () => localStorage.setItem(key, JSON.stringify(journal));
  save();
  try {
    const response = await fetch(`${endpoint}?cohortDigest=${digest}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('cohort_load_failed');
    const payload = await response.json();
    const bytes = new TextEncoder().encode(JSON.stringify(payload.cohort));
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (!payload.success || payload.cohortDigest !== digest || actual !== digest || payload.cohort.records.length !== 61)
      throw new Error('cohort_mismatch');
    const records = payload.cohort.records;
    // Web Lock blocks competing tabs; durable journal blocks interrupted runs.
    for (let offset = 0; offset < records.length; offset += 10) {
      for (const record of records.slice(offset, offset + 10)) {
        const entry = { draftId: record.draftId, batch: Math.floor(offset / 10) + 1, stage: 'preflight', result: null };
        journal.entries.push(entry); save();
        for (const execute of [false, true]) {
          entry.stage = execute ? 'invoking_disposition' : 'preflight'; save();
          const response = await fetch(endpoint, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...record, cohortDigest: digest, execute }), signal: AbortSignal.timeout(15000)
          });
          const result = await response.json();
          if (!response.ok || !result.success || result.draftId !== record.draftId ||
              !(execute ? ['dispositioned', 'already_dispositioned'] : ['eligible', 'already_dispositioned']).includes(result.result))
            throw new Error('rejected_or_unexpected_acknowledgement');
          if (!execute && result.result === 'already_dispositioned') { entry.result = result.result; break; }
          if (execute) entry.result = result.result;
        }
        entry.stage = 'acknowledged'; save();
      }
    }
    journal.status = 'completed'; save();
    console.log({ selected: records.length, dispositioned: journal.entries.filter(e => e.result === 'dispositioned').length,
      already_dispositioned: journal.entries.filter(e => e.result === 'already_dispositioned').length, not_attempted: 0 });
  } catch {
    journal.status = 'STOPPED'; journal.stopReason = 'rejection_timeout_or_lost_acknowledgement'; save();
    console.error('STOP. No further records attempted. Review the local journal and exact audit event; do not automatically retry.');
  }
  });
})()
