"use client";

import { useState } from "react";

type Candidate = {
  id?: string | number;
  patientNumber?: string | number | null;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | null;
  mobile?: string | null;
  matchScore?: number | null;
  matchReason?: string | null;
};

export default function PraktikaMatchCandidatesPanel({
  inboxItemId,
  candidates,
  selectedPatientId,
  onConfirmed,
}: {
  inboxItemId: string;
  candidates?: Candidate[] | null;
  selectedPatientId?: string | null;
  onConfirmed?: (item: any) => void;
}) {
  const [busyPatientId, setBusyPatientId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  if (safeCandidates.length === 0) {
    return null;
  }

  async function confirmCandidate(candidate: Candidate) {
    const patientId = candidate.id ? String(candidate.id) : "";

    if (!patientId) return;

    setBusyPatientId(patientId);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/praktika/confirm-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          patientId,
          patientNumber: candidate.patientNumber || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not confirm patient match.");
      }

      setMessage("Patient match confirmed.");
      onConfirmed?.(result.item);
    } catch (error: any) {
      setMessage(error?.message || "Could not confirm patient match.");
    } finally {
      setBusyPatientId(null);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-purple-200 bg-purple-50 p-4">
      <div className="text-sm font-semibold text-purple-950">
        Possible Praktika matches
      </div>

      <p className="mt-1 text-sm text-purple-800">
        Confirm the correct patient before filing attachments.
      </p>

      <div className="mt-3 space-y-3">
        {safeCandidates.slice(0, 5).map((candidate) => {
          const patientId = candidate.id ? String(candidate.id) : "";
          const isSelected = selectedPatientId === patientId;

          return (
            <div
              key={patientId}
              className="rounded-xl border border-purple-200 bg-white p-3"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold text-slate-950">
                    {[candidate.firstName, candidate.lastName]
                      .filter(Boolean)
                      .join(" ") || "Unnamed patient"}
                  </div>

                  <div className="mt-1 text-xs text-slate-600">
                    Patient ID: {patientId || "-"} · Patient #:{" "}
                    {candidate.patientNumber || "-"} · DOB:{" "}
                    {candidate.dob || "-"}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    Score:{" "}
                    {typeof candidate.matchScore === "number"
                      ? `${Math.round(candidate.matchScore * 100)}%`
                      : "-"}{" "}
                    · {candidate.matchReason || "No match reason available."}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => confirmCandidate(candidate)}
                  disabled={!patientId || busyPatientId === patientId}
                  className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isSelected
                    ? "Selected"
                    : busyPatientId === patientId
                    ? "Confirming..."
                    : "Confirm this patient"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {message ? (
        <p className="mt-3 text-sm text-purple-900">{message}</p>
      ) : null}
    </div>
  );
}