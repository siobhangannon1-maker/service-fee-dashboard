"use client";

import { useEffect, useState } from "react";

type MedirefStatus = {
  success: boolean;
  status: string;
  connected: boolean;
  message: string;
};

export default function MedirefConnectionPanel() {
  const [status, setStatus] = useState<MedirefStatus | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkStatus() {
    setLoading(true);

    try {
      const response = await fetch("/api/mediref/session/status", {
        cache: "no-store",
      });

      const data = await response.json();
      setStatus(data);
    } catch {
      setStatus({
        success: false,
        status: "error",
        connected: false,
        message: "Could not check MediRef connection.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkStatus();
  }, []);

  const connected = status?.connected;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            MediRef connection
          </h3>

          <p className="mt-1 text-sm text-slate-600">
            {status?.message || "Checking MediRef connection..."}
          </p>

          <div className="mt-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                connected
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {connected ? "Connected" : "Needs reconnect"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={checkStatus}
          disabled={loading}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Check"}
        </button>
      </div>

      {!connected && (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          For now, reconnect by logging into MediRef in Chrome, copying the new
          session cookie, updating <code>.env.local</code>, and restarting the
          app. Later we can replace this with a proper reconnect workflow.
        </div>
      )}
    </div>
  );
}