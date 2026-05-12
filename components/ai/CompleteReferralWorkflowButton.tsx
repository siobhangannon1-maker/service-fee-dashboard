"use client";

import { useState } from "react";

type InboxItem = {
  id: string;
  praktika_patient_id?: string | null;
  praktika_referral_id?: string | number | null;
  praktika_filing_status?: string | null;
  praktika_referrer_party_id?: string | number | null;
  praktika_matched_referrer_party_id?: string | number | null;
  referrer_party_id?: string | number | null;
  praktika_referral_party_id?: string | number | null;
  referral_workflow_status?: string | null;
  archived_at?: string | null;
};

function getPartyId(item: InboxItem) {
  return (
    item.praktika_referrer_party_id ||
    item.praktika_matched_referrer_party_id ||
    item.referrer_party_id ||
    item.praktika_referral_party_id ||
    null
  );
}

export default function CompleteReferralWorkflowButton({
  inboxItem,
  onComplete,
}: {
  inboxItem: InboxItem;
  onComplete?: (item: any) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!inboxItem?.id) return null;
  if (!inboxItem.praktika_patient_id) return null;

  const partyId = getPartyId(inboxItem);
  const hasReferral = Boolean(inboxItem.praktika_referral_id);
  const filingCompleted = inboxItem.praktika_filing_status === "completed";
  const canCreateReferral = Boolean(partyId) || hasReferral;
  const isComplete = hasReferral && filingCompleted;

  async function runWorkflow() {
    setMessage("");

    if (!canCreateReferral) {
      setMessage("Match/select a referrer before creating the referral.");
      return;
    }

    const confirmed = window.confirm(
      "Complete referral workflow now?\n\nThis will create the Praktika referral if needed, file attachments, add the AI clinical note, and archive when safe.",
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("Completing referral workflow...");

    try {
      const response = await fetch("/api/ai/referral-workflow/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          inboxItemId: inboxItem.id,
          createReferral: true,
          fileAttachments: true,
          forceFile: false,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Referral workflow failed.");
      }

      setMessage(
        result.archived
          ? "Referral workflow completed and archived."
          : "Referral workflow completed.",
      );

      if (result.item) {
        await onComplete?.(result.item);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Referral workflow failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold">Complete referral workflow</h3>

          <p className="mt-1 text-xs leading-5 text-emerald-800">
            Creates the Praktika referral when a safe referrer is selected,
            files attachments, adds the AI clinical note, and archives when
            safe.
          </p>

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-white/70 p-2">
              Patient: {inboxItem.praktika_patient_id ? "Ready" : "Missing"}
            </div>

            <div className="rounded-xl bg-white/70 p-2">
              Referrer: {canCreateReferral ? "Ready" : "Missing"}
            </div>

            <div className="rounded-xl bg-white/70 p-2">
              Filing: {filingCompleted ? "Completed" : "Pending"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={runWorkflow}
          disabled={busy || isComplete || !canCreateReferral}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Completing..."
            : isComplete
              ? "Workflow complete"
              : "Complete referral workflow"}
        </button>
      </div>

      {message ? <p className="mt-3 text-xs font-medium">{message}</p> : null}
    </section>
  );
}