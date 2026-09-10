"use client";

import { useEffect, useRef, useState } from "react";

type MedirefStatus = {
  success: boolean;
  status: string;
  connected: boolean;
  validForMs?: number;
  message: string;
};

export default function MedirefConnectionPanel() {
  const [status, setStatus] = useState<MedirefStatus | null>(null);
  const version = useRef(0);
  const [deadline, setDeadline] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  const [loading, setLoading] = useState(false);

  async function checkStatus() {
    const current = ++version.current;
    const started = Date.now();
    setLoading(true);

    try {
      const response = await fetch("/api/mediref/session/status", {
        cache: "no-store",
      });

      const data = await response.json();
      if (current !== version.current) return;
      if (!response.ok) throw new Error();
      setDeadline(started + (data.validForMs || 0));
      setClock(Date.now());
      setStatus(data);
    } catch {
      if (current !== version.current) return;
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
    const timer = setInterval(() => { void checkStatus(); }, 5000);
    return () => clearInterval(timer);
  }, []);

  const connected = status?.status === "connected" && status.connected && deadline > clock;

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
              {connected ? "Connected" : status?.status === "waiting_for_mfa" ? "MFA required" : status?.status === "waiting_for_credentials" ? "Login required" : ["refreshing", "refresh_requested"].includes(status?.status || "") ? "Reconnecting" : "Unavailable"}
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
          MediRef can reconnect automatically when work arrives. Use MediRef Tools
          if sign-in or verification needs attention.
        </div>
      )}
    </div>
  );
}