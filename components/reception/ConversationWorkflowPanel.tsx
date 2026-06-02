"use client";

import { useState } from "react";

type ConversationWorkflowPanelProps = {
  conversationId: string;
  workflowStatus?: string | null;
  isUrgent?: boolean | null;
  onUpdated: () => void;
};

export default function ConversationWorkflowPanel({
  conversationId,
  workflowStatus,
  isUrgent,
  onUpdated,
}: ConversationWorkflowPanelProps) {
  const [savingField, setSavingField] = useState<"workflow" | "urgent" | null>(
    null
  );

  async function updateConversation(
    payload: Record<string, string | boolean | null>,
    savingType: "workflow" | "urgent"
  ) {
    setSavingField(savingType);

    try {
      const response = await fetch(`/api/reception/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Could not update conversation.");
        return;
      }

      await onUpdated();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Could not update conversation."
      );
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div className="border-b p-5">
      <h3 className="font-semibold text-slate-900">Conversation actions</h3>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workflow status
        </label>

        <select
          value={workflowStatus || "general"}
          disabled={savingField !== null}
          onChange={(event) =>
            updateConversation(
              {
                workflowStatus: event.target.value,
              },
              "workflow"
            )
          }
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        >
          <option value="general">General</option>
          <option value="waiting_on_patient">Waiting on patient</option>
          <option value="waiting_on_practice">Waiting on practice</option>
          <option value="needs_follow_up">Needs follow-up</option>
        </select>
      </div>

      <button
        type="button"
        disabled={savingField !== null}
        onClick={() =>
          updateConversation(
            {
              isUrgent: !Boolean(isUrgent),
            },
            "urgent"
          )
        }
        className={`mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
          isUrgent
            ? "border border-red-600 bg-red-600 text-white hover:bg-red-700"
            : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
        }`}
      >
        {savingField === "urgent"
          ? "Updating..."
          : isUrgent
          ? "Urgent conversation"
          : "Mark urgent"}
      </button>

      {isUrgent && (
        <p className="mt-2 text-xs text-red-600">
          This conversation is marked urgent and will appear with an urgent badge
          in the inbox.
        </p>
      )}
    </div>
  );
}
