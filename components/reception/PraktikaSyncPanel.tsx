"use client";

import { useState } from "react";

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) {
    return {
      error: `Request failed with status ${response.status}. No response body.`,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `Request failed with status ${response.status}. Response was not JSON: ${text.slice(
        0,
        200
      )}`,
    };
  }
}

export default function PraktikaSyncPanel() {
  const [loading, setLoading] = useState<"recent" | "all" | null>(null);
  const [message, setMessage] = useState("");

  async function syncPatients(mode: "recent" | "all") {
    setLoading(mode);
    setMessage("");

    const response = await fetch("/api/praktika/sync-patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, pageSize: 500, maxPages: mode === "all" ? 100 : 2 }),
    });

    const data = await readJsonSafely(response);
    setLoading(null);

    if (!response.ok) {
      setMessage(data.error || `Sync failed with status ${response.status}`);
      return;
    }

    setMessage(`Synced ${data.rowsUpserted} patients`);
    window.setTimeout(() => setMessage(""), 4000);
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => syncPatients("recent")}
        disabled={loading !== null}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading === "recent" ? "Syncing..." : "Sync recent"}
      </button>

      <button
        type="button"
        onClick={() => syncPatients("all")}
        disabled={loading !== null}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading === "all" ? "Syncing all..." : "Sync all"}
      </button>

      {message && <span className="text-slate-500">{message}</span>}
    </div>
  );
}