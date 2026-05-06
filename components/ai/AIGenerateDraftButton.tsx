"use client";

import { useState } from "react";

type AIGenerateDraftButtonProps = {
  inboxItemId: string;
};

type DraftResponse = {
  success?: boolean;
  error?: string;
  subject?: string;
  body?: string;
};

export default function AIGenerateDraftButton({
  inboxItemId,
}: AIGenerateDraftButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<DraftResponse | null>(null);

  async function generateDraft() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/ai/email/generate-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to generate draft.");
        return;
      }

      setDraft(result);
      setMessage("AI draft generated successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to generate draft."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            AI Draft Generation
          </p>

          <p className="mt-1 text-xs text-slate-600">
            Generate a suggested patient or referrer email draft.
          </p>
        </div>

        <button
          type="button"
          onClick={generateDraft}
          disabled={loading}
          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Generating..." : "Generate Draft"}
        </button>
      </div>

      {message ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {draft?.subject || draft?.body ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Subject
            </p>

            <p className="mt-1 text-sm font-medium text-slate-900">
              {draft.subject || "No subject generated"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Draft
            </p>

            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {draft.body || "No draft body generated"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}