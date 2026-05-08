"use client";

import { useState } from "react";

export default function ImportOutlookInboxButton() {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function importInbox() {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/import-outlook-inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: 10,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Import failed.");
        return;
      }

      const importedCount = (result.results || []).filter(
        (item: any) => item.imported
      ).length;

      const attachmentCount = (result.results || []).reduce(
        (total: number, item: any) => total + (item.attachments_imported || 0),
        0
      );

      setMessage(
        `Imported ${importedCount} new email(s), ${attachmentCount} attachment(s). Refreshing...`
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={importInbox}
        disabled={working}
        className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {working ? "Importing..." : "Import Outlook inbox"}
      </button>

      {message ? (
        <p className="max-w-xs text-right text-xs text-slate-500">{message}</p>
      ) : null}
    </div>
  );
}