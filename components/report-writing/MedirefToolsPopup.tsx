"use client";

import { useEffect, useRef, useState } from "react";

type MedirefToolsPopupProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
};

type SessionStatus = {
  scope?: string;
  status?: string;
  message?: string | null;
  currentUrl?: string | null;
  medirefEmail?: string | null;
  email?: string | null;
  connected?: boolean;
  validForMs?: number;
  updatedAt?: string | null;
  refreshRequestedAt?: string | null;
  refreshedAt?: string | null;
  lastUsedAt?: string | null;
  mfaCodeUpdatedAt?: string | null;
};

type ConnectionState = "connected" | "connecting" | "disconnected" | "login" | "mfa";

function getConnectionState(status?: string, connected?: boolean): ConnectionState {
  if (connected) return "connected";

  if (status === "waiting_for_credentials") return "login";
  if (status === "waiting_for_mfa") return "mfa";
  if (
    status === "refreshing" ||
    status === "refresh_requested" ||
    status === "waiting_for_mfa"
  ) {
    return "connecting";
  }

  return "disconnected";
}

function connectionLabel(state: ConnectionState) {
  if (state === "connected") return "Connected";
  if (state === "login") return "Login required";
  if (state === "mfa") return "MFA required";
  if (state === "connecting") return "Connecting";
  return "Not connected";
}

function dotClass(state: ConnectionState) {
  if (state === "connected") return "bg-emerald-500";
  if (state === "connecting") return "bg-orange-500";
  return "bg-red-500";
}

export default function MedirefToolsPopup({
  open,
  onOpenChange,
  onClose,
}: MedirefToolsPopupProps) {
  const [checking, setChecking] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);

  const [mfaCode, setMfaCode] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const [displayStatus, setDisplayStatus] = useState("not_started");
  const [displayConnected, setDisplayConnected] = useState(false);
  const requestVersion = useRef(0);
  const [expiresAt, setExpiresAt] = useState(0);
  useEffect(() => {
    if (!displayConnected) return;
    const timer = setTimeout(() => { setDisplayConnected(false); setDisplayStatus("not_started"); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, displayConnected]);

  const currentStatus = displayStatus;
  const currentConnectionState = getConnectionState(
    currentStatus,
    displayConnected,
  );
  const isConnected = currentConnectionState === "connected";
  const isConnecting = currentConnectionState === "connecting";

  const shouldShowMfaForm = currentStatus === "waiting_for_mfa";

  function closePopup() {
    if (onOpenChange) {
      onOpenChange(false);
      return;
    }

    if (onClose) {
      onClose();
    }
  }

  function commitDisplayStatus(status: string, connected: boolean) {
    setDisplayStatus(status || "not_started");
    setDisplayConnected(connected);
  }

  async function loadStatus() {
    const version = ++requestVersion.current;
    const started = Date.now();
    try {
      setChecking(true);
      const response = await fetch("/api/mediref/session/status?scope=practice", { cache: "no-store" });
      const data: SessionStatus = await response.json();
      if (version !== requestVersion.current) return;
      if (!response.ok || !data) throw new Error();
      const deadline = started + (typeof data.validForMs === "number" ? data.validForMs : 0);
      setExpiresAt(deadline);
      commitDisplayStatus(data.status || "not_started", data.status === "connected" && data.connected === true && deadline > Date.now());
    } catch {
      if (version !== requestVersion.current) return;
      commitDisplayStatus("error", false);
    } finally { setChecking(false); }
  }

  useEffect(() => {
    if (!open) return;

    loadStatus();

    const interval = window.setInterval(() => {
      loadStatus();
    }, 5000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function requestReconnect() {
    setLocalMessage(null);
    setRefreshSubmitting(true);
    requestVersion.current++;
    commitDisplayStatus("refresh_requested", false);

    try {
      const response = await fetch("/api/mediref/session/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "practice",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false || data.ok === false) {
        setLocalMessage(
          data.error || data.message || "Could not connect to MediRef.",
        );
        commitDisplayStatus("error", false);
        return;
      }

      setLocalMessage("Connect requested. Keep the Cloud MediRef watcher running.");
      await loadStatus();
    } finally {
      setRefreshSubmitting(false);
    }
  }

  async function submitMfaCode() {
    const code = mfaCode.replace(/\D/g, "").trim();

    if (!code) {
      setLocalMessage("Enter the MediRef verification code.");
      return;
    }

    setLocalMessage(null);
    setMfaSubmitting(true);
    commitDisplayStatus("refreshing", false);

    try {
      const response = await fetch("/api/mediref/session/mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "practice",
          code,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false || data.ok === false) {
        setLocalMessage(
          data.error || data.message || "Could not submit the MediRef code.",
        );
        commitDisplayStatus("waiting_for_mfa", false);
        return;
      }

      setMfaCode("");
      setLocalMessage("Code submitted. Waiting for MediRef to connect.");
      await loadStatus();
    } finally {
      setMfaSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[460px] max-w-[calc(100vw-2rem)] rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">MediRef tools</h2>
          <p className="text-xs text-slate-500">
            Shared practice MediRef session for referral delivery.
          </p>
        </div>

        <button
          type="button"
          onClick={closePopup}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${dotClass(
                    currentConnectionState,
                  )}`}
                />
                <h3 className="text-sm font-bold text-slate-950">
                  MediRef: {connectionLabel(currentConnectionState)}
                </h3>
              </div>

              {currentConnectionState === "disconnected" ? (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  MediRef can reconnect automatically when work arrives. Use Connect if sign-in needs attention.
                </p>
              ) : null}

              {localMessage ? (
                <p className="mt-2 text-xs font-semibold text-blue-700">
                  {localMessage}
                </p>
              ) : null}
            </div>

            {!isConnected ? (
              <button
                type="button"
                onClick={requestReconnect}
                disabled={refreshSubmitting || isConnecting}
                className="shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {refreshSubmitting || isConnecting ? "Connecting" : "Connect"}
              </button>
            ) : null}
          </div>
        </div>

        {shouldShowMfaForm ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3">
            <h3 className="text-sm font-bold text-orange-950">
              Verification code
            </h3>

            <p className="mt-1 text-xs text-orange-900">
              Enter the code sent by MediRef. The helper on the Cloud will
              continue the login automatically.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                className="flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm"
                placeholder="Verification code"
              />

              <button
                type="button"
                onClick={submitMfaCode}
                disabled={mfaSubmitting}
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {mfaSubmitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}
