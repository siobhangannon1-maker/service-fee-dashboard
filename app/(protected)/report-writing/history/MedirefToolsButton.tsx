"use client";
import { useEffect, useRef, useState } from "react";
import type { ToolsStatus } from "@/lib/mediref/tools-status";

export function MedirefToolsButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ToolsStatus | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [clock, setClock] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  useEffect(() => {
    const timer = setInterval(() => { if (dialog.current?.open) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    const current = ++version.current;
    const started = Date.now();
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/report-writing/mediref-tools/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error();
      if (current !== version.current) return;
      setDeadline(started + (data.session?.validForMs || 0));
      setClock(Date.now());
      setStatus(data);
    } catch { if (current !== version.current) return; setStatus(null); setMessage("Unable to load MediRef status."); }
    finally { setBusy(false); }
  }
  async function reconnect() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/mediref/session/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "practice" }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false || data.success === false) throw new Error();
      await refresh();
      setMessage(data.alreadyConnected ? "MediRef is already connected." : "MediRef reconnect requested.");
    } catch { setMessage("Unable to request MediRef reconnect."); }
    finally { setBusy(false); }
  }
  const connection = status?.session.status === "connected" ? (deadline > clock ? "Connected" : "Unavailable") : status?.session.status === "error" ? "Error" :
    status?.session.status === "ready" ? "Ready — authentication unverified" : status?.session.status === "sleeping" ? "Sleeping" :
    ["refreshing", "refresh_requested"].includes(status?.session.status || "") ? "Reconnecting" :
    status?.session.status === "waiting_for_credentials" ? "Login required" : status?.session.status === "waiting_for_mfa" ? "MFA required" :
    ["expired", "not_started"].includes(status?.session.status || "") ? "Needs reconnect" : "Unknown";
  return <>
    <button type="button" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold" onClick={() => { dialog.current?.showModal(); void refresh(); }}>MediRef Tools</button>
    <dialog ref={dialog} aria-labelledby="mediref-tools-title" className="m-auto w-[460px] max-w-[calc(100vw-2rem)] rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl backdrop:bg-black/30">
      <h2 id="mediref-tools-title" className="text-lg font-bold text-slate-950">MediRef Tools</h2>
      <div aria-busy={busy} className="my-4 space-y-2 text-sm text-slate-700">
        {busy && <p role="status">Loading…</p>}
        <p>Connection: {connection}</p>
        <p>Session message: {status?.session.message || "Unknown"}</p>
        <p>Last refreshed: {status?.session.refreshedAt || "Unknown"}</p>
        <p>Last used: {status?.session.lastUsedAt || "Unknown"}</p>
        <p>Latest MediRef job: {status?.latestJob?.status || "None available"}</p>
        {status?.latestJob && <>
          <p>Job type: {status.latestJob.jobType}</p>
          <p>Created: {status.latestJob.createdAt || "Unknown"}</p>
          <p>Updated: {status.latestJob.updatedAt || "Unknown"}</p>
          {status.latestJob.error && <p>{status.latestJob.error}</p>}
        </>}
        <p>Last MediRef failure stage: Not stored; check Render logs.</p>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={refresh} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50">Refresh Status</button>
        <button type="button" disabled={busy} onClick={reconnect} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50">Reconnect MediRef</button>
        <button type="button" onClick={() => dialog.current?.close()} className="rounded-xl border px-3 py-2 text-xs font-semibold">Close</button>
      </div>
    </dialog>
  </>;
}
