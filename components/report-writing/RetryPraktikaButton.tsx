"use client";
import { useEffect, useRef, useState } from 'react';
export function RetryPraktikaButton({ draftId, onQueued }: { draftId: string; onQueued: () => void }) {
  const [priorJobId, setPriorJobId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setPriorJobId(null); setConfirming(false);
    fetch(`/api/report-writing/retry-praktika?draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store', signal: controller.signal })
      .then(r => r.json()).then(r => { if (!controller.signal.aborted && r.eligible) setPriorJobId(r.priorJobId); }).catch(() => {});
    return () => controller.abort();
  }, [draftId]);
  async function retry() {
    if (!confirming || !priorJobId || submitting.current) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/report-writing/retry-praktika', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, priorJobId, verifiedAbsent: true }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setMessage(result.error || 'Retry could not be confirmed. Refresh to check the workflow.'); return; }
      setPriorJobId(null); setConfirming(false); setMessage('Praktika retry reserved. Continuing in background.'); onQueued();
    } catch { setMessage('Retry could not be confirmed. Refresh to check the workflow; the same attempt will be reconciled.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="mt-2 text-xs">
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
