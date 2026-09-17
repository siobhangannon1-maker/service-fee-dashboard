"use client";
import { useEffect, useRef, useState } from 'react';
export function RetryPraktikaButton({ draftId, workflowStatus, uploadStatus, recoveryMessage, onQueued }: { draftId: string; workflowStatus?: string | null; uploadStatus?: string | null; recoveryMessage?: string | null; onQueued: () => void }) {
  const [priorJobId, setPriorJobId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const [reason, setReason] = useState('idle');
  const eligibilityRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setPriorJobId(null); setConfirming(false); setReason('idle'); setMessage('');
    return () => { eligibilityRequest.current?.abort(); eligibilityRequest.current = null; };
  }, [draftId, workflowStatus, uploadStatus, recoveryMessage]);
  async function checkEligibility() {
    if (eligibilityRequest.current || submitting.current) return;
    const controller = new AbortController();
    eligibilityRequest.current = controller;
    setPriorJobId(null); setConfirming(false); setReason('checking'); setMessage('');
    try {
      const response = await fetch(`/api/report-writing/retry-praktika?draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok && result.eligible && typeof result.priorJobId === 'string') {
        setPriorJobId(result.priorJobId); setReason('eligible'); setConfirming(true); return;
      }
      const safeReason = ['unauthenticated', 'inactive_user', 'unauthorized_for_provider', 'workflow_not_terminal',
        'upload_not_failed', 'replacement_active', 'already_verified', 'invalid_state', 'lookup_unavailable'].includes(result.reason)
        ? result.reason : 'lookup_unavailable';
      setReason(safeReason);
    } catch { if (!controller.signal.aborted) setReason('lookup_unavailable'); }
    finally { if (eligibilityRequest.current === controller) eligibilityRequest.current = null; }
  }
  async function retry() {
    if (!confirming || !priorJobId || submitting.current) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/report-writing/retry-praktika', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, priorJobId, verifiedAbsent: true }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setMessage(result.error || 'Retry could not be confirmed. Refresh to check the workflow.'); return; }
      if (result.manuallyVerified) { setPriorJobId(null); setConfirming(false); setReason('already_verified'); setMessage('Praktika completion was already manually verified. Nothing was uploaded again.'); onQueued(); return; }
      setPriorJobId(null); setConfirming(false); setReason('replacement_active'); setMessage('Praktika retry reserved. Continuing in background.'); onQueued();
    } catch { setMessage('Retry could not be confirmed. Refresh to check the workflow; the same attempt will be reconciled.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="mt-2 text-xs" aria-label="Praktika recovery">
    {reason !== 'idle' && !priorJobId && <p role="status">{
      reason === 'checking' ? 'Preparing Praktika retry options…'
      : reason === 'workflow_not_terminal' ? 'Workflow is still finishing. Check again when it has stopped.'
      : reason === 'unauthorized_for_provider' ? 'You do not have permission to retry Praktika for this provider.'
      : reason === 'inactive_user' ? 'An active account is required to retry Praktika.'
      : reason === 'unauthenticated' ? 'Sign in to check Praktika retry availability.'
      : reason === 'already_verified' ? 'Praktika completion has been manually verified.'
      : reason === 'replacement_active' ? 'Praktika retry is already in progress.'
      : reason === 'lookup_unavailable' ? 'Retry availability could not be checked.'
      : 'This upload is not currently eligible for retry. Refresh to check the workflow.'
    }</p>}
    {!confirming && <button type="button" disabled={busy || reason === 'checking'} className="rounded border px-3 py-2" onClick={checkEligibility}>
      {reason === 'checking' ? 'Checking…' : reason === 'idle' || reason === 'eligible' ? 'Retry Praktika' : 'Check again'}
    </button>}
    {confirming && <div role="alertdialog" aria-label="Verify Praktika upload" className="space-y-2 rounded border p-2">
      <p>Have you checked the patient's file in Praktika and confirmed that this letter is not already there?</p>
      <p>Retrying may create a duplicate if the previous upload actually succeeded.</p>
      <button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={retry}>Yes — retry Praktika</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
