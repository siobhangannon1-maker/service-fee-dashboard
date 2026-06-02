"use client";

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
  async function updateConversation(payload: any) {
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

    onUpdated();
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
          onChange={(event) =>
            updateConversation({
              workflowStatus: event.target.value,
            })
          }
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="general">General</option>
          <option value="waiting_on_patient">Waiting on patient</option>
          <option value="waiting_on_practice">Waiting on practice</option>
          <option value="needs_follow_up">Needs follow-up</option>
        </select>
      </div>

      <button
        type="button"
        onClick={() =>
          updateConversation({
            isUrgent: !isUrgent,
          })
        }
        className={`mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold ${
          isUrgent
            ? "bg-red-600 text-white"
            : "border border-red-200 bg-red-50 text-red-700"
        }`}
      >
        {isUrgent ? "Urgent conversation" : "Mark urgent"}
      </button>
    </div>
  );
}