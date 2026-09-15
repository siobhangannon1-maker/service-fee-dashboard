"use client";
import { useEffect, useRef, useState } from 'react';
import type { ManualVerification } from '@/lib/report-writing/manual-verification';
export function ManualVerificationHistory({ entries }: { entries?: ManualVerification[] }) {
  return <>{entries?.map(entry => <p className="text-xs text-slate-600" key={entry.integration}>
    {entry.integration === 'praktika' ? 'Praktika' : 'MediRef'} manually verified as completed by staff ({entry.actorUserId}) at {new Date(entry.verifiedAt).toLocaleString()}.
    {' '}Earlier failed attempt {entry.priorJobId} retained in audit.
  </p>)}</>;
}
export function ManualVerificationButton({ draftId, integration, onVerified }: {
  draftId: string; integration: 'praktika' | 'mediref'; onVerified: () => void;
}) {
  const [priorJobId, setPriorJobId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const label = integration === 'praktika' ? 'Praktika' : 'MediRef';
  useEffect(() => {
    const controller = new AbortController();
    setPriorJobId(null); setConfirming(false);
    fetch(`/api/report-writing/verify-workflow-completion?draftId=${encodeURIComponent(draftId)}&integration=${integration}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!controller.signal.aborted && response.ok && data.eligible) setPriorJobId(data.priorJobId); })
      .catch(() => { if (!controller.signal.aborted) setMessage('Verification availability could not be checked. Refresh to try again.'); });
    return () => controller.abort();
  }, [draftId, integration]);
  async function verify() {
    if (!confirming || !priorJobId || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const response = await fetch('/api/report-writing/verify-workflow-completion', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, integration, priorJobId, verifiedSuccess: true }) });
      const data = await response.json();
      if (!response.ok || !data.success) { setMessage(data.error || 'Verification could not be confirmed. Refresh to check the workflow.'); return; }
      setPriorJobId(null); setConfirming(false); setMessage(`${label} completion manually verified.`); onVerified();
    } catch { setMessage('Verification could not be confirmed. Refresh to check the workflow before trying again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="mt-2 text-xs">
    {priorJobId && !confirming && <button type="button" className="rounded border px-3 py-2" onClick={() => setConfirming(true)}>Mark {label} completed</button>}
    {confirming && <div role="alertdialog" aria-label={`Verify ${label} completion`} className="space-y-2 rounded border p-2">
      <p>{integration === 'praktika' ? "Have you checked the patient's file in Praktika and confirmed that this letter is already there?" : 'Have you checked MediRef and confirmed that this correspondence was successfully prepared/sent?'}</p>
      <p>{integration === 'praktika' ? 'This will mark the Praktika upload as manually verified. Nothing will be uploaded again.' : 'This will mark the MediRef step as manually verified. Nothing will be sent again.'}</p>
      <button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={verify}>Yes — mark {label} completed</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
