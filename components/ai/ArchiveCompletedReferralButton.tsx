"use client";

import { useState } from "react";

type InboxItem = {
  id: string;
  archived_at?: string | null;
  praktika_patient_id?: string | null;
  praktika_referral_id?: string | null;
  praktika_filing_status?: string | null;
  referral_workflow_status?: string | null;
  referral_workflow_result?: any;
};

function filingLooksComplete(item: InboxItem) {
  if (item.praktika_filing_status === "completed") return true;

  const filingResult = item.referral_workflow_result?.filingResult;

  return (
    item.referral_workflow_status === "completed" &&
    (filingResult?.ok === true || Boolean(filingResult?.filedAt))
  );
}

export default function ArchiveCompletedReferralButton({
  inboxItem,
  onArchived,
}: {
  inboxItem: InboxItem;
  onArchived?: (item: any) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!inboxItem?.id || inboxItem.archived_at) return null;

  const looksComplete =
    Boolean(inboxItem.praktika_patient_id) &&
    Boolean(inboxItem.praktika_referral_id) &&
    filingLooksComplete(inboxItem);

  async function archiveCompleted() {
    setBusy(true);
    setMessage("Checking completion gates...");

    try {
      const response = await fetch(
        "/api/ai/referral-workflow/archive-completed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inboxItemId: inboxItem.id }),
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        const blockers = Array.isArray(result?.blockers)
          ? ` ${result.blockers.join(" ")}`
          : "";
        throw new Error(result?.error || `Archive blocked.${blockers}`);
      }

      setMessage("Completed referral item archived.");

      if (result.item) {
        await onArchived?.(result.item);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Archive completed referral failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <h3 className="text-sm font-bold">Archive completed referral</h3>

      <p className="mt-1 text-xs text-emerald-800">
        Archives only when the patient exists, referral exists, and attachments
        are filed.
      </p>

      <button
        type="button"
        onClick={archiveCompleted}
        disabled={busy || !looksComplete}
        className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Archiving..." : "Archive completed referral"}
      </button>

      {!looksComplete ? (
        <p className="mt-3 text-xs text-emerald-800">
          Waiting for completed patient, referral, and filing steps.
        </p>
      ) : null}

      {message ? <p className="mt-3 text-xs font-medium">{message}</p> : null}
    </section>
  );
}