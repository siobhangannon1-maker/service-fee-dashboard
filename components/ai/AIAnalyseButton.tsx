"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AIAnalyseButtonProps = {
  inboxItemId: string;
  subject?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  emailBody?: string | null;
  existingCategory?: string | null;
  patientName?: string | null;
  patientDob?: string | null;
};

export default function AIAnalyseButton({
  inboxItemId,
  subject,
  senderName,
  senderEmail,
  emailBody,
  existingCategory,
  patientName,
  patientDob,
}: AIAnalyseButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/ai/brain/analyse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          subject,
          senderName,
          senderEmail,
          emailBody,
          existingCategory,
          patientName,
          patientDob,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "AI Brain analysis failed.");
      }

      setMessage("AI Brain analysis created.");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-slate-900">AI Brain</p>
        <p className="text-xs text-slate-500">
          Analyse risks, confidence, missing information and next step.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2 sm:items-end">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={loading}
          className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Analysing..." : "Run AI Brain"}
        </button>

        {message ? (
          <p className="max-w-xs text-xs text-slate-500">{message}</p>
        ) : null}
      </div>
    </div>
  );
}