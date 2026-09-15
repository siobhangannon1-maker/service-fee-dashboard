"use client";
import { useEffect, useRef, useState } from 'react';
export function RetryPraktikaButton({ draftId, workflowStatus, uploadStatus, recoveryMessage, onQueued }: { draftId: string; workflowStatus?: string | null; uploadStatus?: string | null; recoveryMessage?: string | null; onQueued: () => void }) {
  const [priorJobId, setPriorJobId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const [reason, setReason] = useState('checking');
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPriorJobId(null); setConfirming(false); setReason('checking');
    fetch(`/api/report-writing/retry-praktika?draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && result.eligible && typeof result.priorJobId === 'string') {
          setPriorJobId(result.priorJobId); setReason('eligible'); return;
        }
        const safeReason = ['unauthenticated', 'inactive_user', 'unauthorized_for_provider', 'workflow_not_terminal',
          'upload_not_failed', 'replacement_active', 'invalid_state', 'lookup_unavailable'].includes(result.reason)
          ? result.reason : 'lookup_unavailable';
        setReason(safeReason);
        // Only wait for the parent to catch up; never create a job from a recheck.
        if (safeReason === 'workflow_not_terminal') timer = setTimeout(() => setCheck(value => value + 1), 15000);
      }).catch(() => { if (!controller.signal.aborted) setReason('lookup_unavailable'); });
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [draftId, workflowStatus, uploadStatus, recoveryMessage, check]);
  async function retry() {
    if (!confirming || !priorJobId || submitting.current) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/report-writing/retry-praktika', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, priorJobId, verifiedAbsent: true }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setMessage(result.error || 'Retry could not be confirmed. Refresh to check the workflow.'); return; }
      setPriorJobId(null); setConfirming(false); setReason('replacement_active'); setMessage('Praktika retry reserved. Continuing in background.'); onQueued();
    } catch { setMessage('Retry could not be confirmed. Refresh to check the workflow; the same attempt will be reconciled.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="mt-2 text-xs" aria-label="Praktika recovery">
    {!priorJobId && <p role="status">{
      reason === 'checking' || reason === 'workflow_not_terminal' ? 'Preparing Praktika retry options…'
      : reason === 'unauthorized_for_provider' ? 'You do not have permission to retry Praktika for this provider.'
      : reason === 'inactive_user' ? 'An active account is required to retry Praktika.'
      : reason === 'unauthenticated' ? 'Sign in to check Praktika retry availability.'
      : reason === 'replacement_active' ? 'Praktika retry is already in progress.'
      : reason === 'lookup_unavailable' ? 'Retry availability could not be checked.'
      : 'This upload is not currently eligible for retry. Refresh to check the workflow.'
    }</p>}
    {['lookup_unavailable', 'invalid_state', 'upload_not_failed'].includes(reason) &&
      <button type="button" className="rounded border px-3 py-2" onClick={() => setCheck(value => value + 1)}>Check again</button>}
    {priorJobId && !confirming && <button type="button" className="rounded border px-3 py-2" onClick={() => setConfirming(true)}>Retry Praktika</button>}
    {confirming && <div role="alertdialog" aria-label="Verify Praktika upload" className="space-y-2 rounded border p-2">
      <p>Have you checked the patient's file in Praktika and confirmed that this letter is not already there?</p>
      <p>Retrying may create a duplicate if the previous upload actually succeeded.</p>
      <button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={retry}>Yes — retry Praktika</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
