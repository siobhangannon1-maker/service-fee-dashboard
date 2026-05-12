"use client";

import { useState } from "react";

export default function BulkArchiveInboxItemsButton({
  selectedIds,
  onArchived,
}: {
  selectedIds: string[];
  onArchived: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function archiveSelected() {
    if (selectedIds.length === 0) return;

    const confirmed = window.confirm(
      `Archive ${selectedIds.length} selected item${
        selectedIds.length === 1 ? "" : "s"
      }?`
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      const res = await fetch("/api/ai/workbench/archive-bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemIds: selectedIds,
          reason: "Archived from Workbench bulk selection",
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        throw new Error(json.error || "Bulk archive failed.");
      }

      await onArchived();
    } catch (error: any) {
      alert(error?.message || "Bulk archive failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={archiveSelected}
      disabled={busy || selectedIds.length === 0}
      className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy
        ? "Archiving..."
        : selectedIds.length === 0
        ? "Archive selected"
        : `Archive selected (${selectedIds.length})`}
    </button>
  );
}