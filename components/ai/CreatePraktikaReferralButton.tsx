"use client";

import { useState } from "react";

type InboxItem = {
  id: string;
  praktika_referrer_party_id?: string | number | null;
  praktika_patient_id?: string | number | null;
  praktika_referral_id?: string | number | null;
  extracted_referral_reason?: string | null;
  summary?: string | null;
};

export default function CreatePraktikaReferralButton({
  inboxItem,
  onCreated,
}: {
  inboxItem: InboxItem;
  onCreated?: (item: any) => void | Promise<void>;
}) {
  const [partyId, setPartyId] = useState(inboxItem.praktika_referrer_party_id ? String(inboxItem.praktika_referrer_party_id) : "");
  const [reason, setReason] = useState(inboxItem.extracted_referral_reason || inboxItem.summary || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!inboxItem.praktika_patient_id) return null;

  if (inboxItem.praktika_referral_id) {
    return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Praktika referral already created: {inboxItem.praktika_referral_id}</div>;
  }

  async function createReferral() {
    if (!partyId.trim()) {
      setMessage("Search/select a referrer first, or enter the partyId manually.");
      return;
    }
    setBusy(true);
    setMessage("Creating Praktika referral...");
    try {
      const response = await fetch("/api/praktika/referral/create-from-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxItemId: inboxItem.id, partyId: partyId.trim(), reason: reason.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Failed to create Praktika referral.");
      setMessage("Praktika referral created.");
      if (result.item) await onCreated?.(result.item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create Praktika referral.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <h3 className="text-sm font-bold">Create Praktika referral</h3>
      <p className="mt-1 text-xs text-blue-800">Create the referral after the patient file exists and the referrer party/location is confirmed.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium">Referrer partyId *</span>
          <input value={partyId} onChange={(event) => setPartyId(event.target.value)} className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-950" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Reason for referral</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-950" />
        </label>
      </div>
      <button type="button" onClick={createReferral} disabled={busy} className="mt-4 rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Creating..." : "Create Praktika referral"}
      </button>
      {message ? <p className="mt-3 text-xs font-medium">{message}</p> : null}
    </section>
  );
}
