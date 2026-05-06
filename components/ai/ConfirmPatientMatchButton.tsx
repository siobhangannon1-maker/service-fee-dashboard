"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ConfirmPatientMatchButtonProps = {
  inboxItemId: string;
  matchCandidateId: string;
  disabled?: boolean;
};

export default function ConfirmPatientMatchButton({
  inboxItemId,
  matchCandidateId,
  disabled = false,
}: ConfirmPatientMatchButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function confirmMatch() {
    const confirmed = window.confirm(
      "Confirm this patient match for this inbox item?"
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const res = await fetch("/api/ai/patient-match/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          matchCandidateId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to confirm patient match.");
      }

      router.refresh();
    } catch (error: any) {
      alert(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={confirmMatch}
      disabled={loading || disabled}
      className="rounded-2xl bg-purple-700 px-3 py-1 text-xs font-medium text-white hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Confirming..." : "Confirm match"}
    </button>
  );
}