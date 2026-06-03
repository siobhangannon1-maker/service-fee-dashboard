"use client";

import { useEffect, useState } from "react";

type PraktikaToolsPopupProps = {
  open: boolean;

  // Current typist page naming
  onOpenChange?: (open: boolean) => void;
  onQueueFromDateChange?: (value: string) => void;
  onQueueToDateChange?: (value: string) => void;
  loadingQueue?: boolean;
  loadingReferrers?: boolean;
  message?: string | null;

  // Older popup naming, kept so other pages do not break
  onClose?: () => void;
  setQueueFromDate?: (value: string) => void;
  setQueueToDate?: (value: string) => void;
  syncingQueue?: boolean;
  syncingReferrers?: boolean;
  preSyncMessage?: string | null;

  queueFromDate: string;
  queueToDate: string;
  onSyncQueue: () => Promise<void> | void;
  onSyncReferrers: () => Promise<void> | void;
  needsReconnect?: boolean;
};

type SessionStatus = {
  status?: string;
  message?: string | null;
  praktikaUsername?: string | null;
  praktika_username?: string | null;
  username?: string | null;
  hasCookie?: boolean;
  has_cookie?: boolean;
};

function statusLabel(status?: string) {
  if (status === "connected") return "Connected";
  if (status === "refreshing") return "Reconnecting";
  if (status === "refresh_requested") return "Reconnect requested";
  if (status === "waiting_for_credentials") return "Login needed";
  if (status === "waiting_for_mfa") return "MFA needed";
  if (status === "expired") return "Expired";
  if (status === "error") return "Error";
  return "Not connected";
}

function dotClass(status?: string) {
  if (status === "connected") return "bg-emerald-500";

  if (status === "refreshing" || status === "refresh_requested") {
    return "bg-blue-500";
  }

  if (
    status === "waiting_for_credentials" ||
    status === "waiting_for_mfa" ||
    status === "expired"
  ) {
    return "bg-amber-500";
  }

  if (status === "error") return "bg-red-500";

  return "bg-slate-400";
}

export default function PraktikaToolsPopup({
  open,
  onOpenChange,
  onClose,
  queueFromDate,
  queueToDate,
  onQueueFromDateChange,
  onQueueToDateChange,
  setQueueFromDate,
  setQueueToDate,
  onSyncQueue,
  onSyncReferrers,
  loadingQueue,
  loadingReferrers,
  syncingQueue,
  syncingReferrers,
  message,
  preSyncMessage,
  needsReconnect = false,
}: PraktikaToolsPopupProps) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const currentStatus = session?.status || "not_started";
  const lastUsername =
    session?.praktikaUsername ||
    session?.praktika_username ||
    session?.username ||
    "";

  const finalSyncingQueue = Boolean(loadingQueue ?? syncingQueue);
  const finalSyncingReferrers = Boolean(loadingReferrers ?? syncingReferrers);
  const finalMessage = message ?? preSyncMessage ?? null;
  const isConnected = currentStatus === "connected";

  // Helper-job syncs use the live local helper browser.
  // Do not require a saved copied cookie here; copied-cookie checks were causing
  // false "reconnect required" states even when the helper browser was connected.
  const shouldShowReconnectWarning = needsReconnect && !isConnected;
  const shouldShowCredentialForm = !isConnected;

  function closePopup() {
    if (onOpenChange) {
      onOpenChange(false);
      return;
    }

    if (onClose) {
      onClose();
    }
  }

  function updateQueueFromDate(value: string) {
    if (onQueueFromDateChange) {
      onQueueFromDateChange(value);
      return;
    }

    if (setQueueFromDate) {
      setQueueFromDate(value);
    }
  }

  function updateQueueToDate(value: string) {
    if (onQueueToDateChange) {
      onQueueToDateChange(value);
      return;
    }

    if (setQueueToDate) {
      setQueueToDate(value);
    }
  }

  async function loadStatus() {
    try {
      setChecking(true);

      const response = await fetch("/api/praktika/session/status?scope=user", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json().catch(() => null);

      if (data) {
        setSession(data);
      }
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    loadStatus();

    const interval = window.setInterval(() => {
      loadStatus();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [open]);

  async function requestReconnect() {
    setLocalMessage(null);
    setRefreshSubmitting(true);

    try {
      const response = await fetch("/api/praktika/session/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "user",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        setLocalMessage(data.error || "Could not request Praktika reconnect.");
        return;
      }

      setLocalMessage("Reconnect requested. Keep the local Praktika watcher open.");
      await loadStatus();
    } finally {
      setRefreshSubmitting(false);
    }
  }

  async function submitCredentials() {
    if (!username.trim() || !password.trim()) {
      setLocalMessage("Enter both Praktika username and password.");
      return;
    }

    setLocalMessage(null);
    setCredentialsSubmitting(true);

    try {
      const response = await fetch("/api/praktika/session/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "user",
          username: username.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        setLocalMessage(data.error || "Could not submit Praktika credentials.");
        return;
      }

      setPassword("");
      setLocalMessage(
        "Credentials submitted. The local helper will continue the login.",
      );

      await loadStatus();
    } finally {
      setCredentialsSubmitting(false);
    }
  }

  async function submitMfaCode() {
    const code = mfaCode.replace(/\D/g, "").trim();

    if (!code) {
      setLocalMessage("Enter the MFA code from Praktika.");
      return;
    }

    setLocalMessage(null);
    setMfaSubmitting(true);

    try {
      const response = await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "user",
          code,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        setLocalMessage(data.error || "Could not submit MFA code.");
        return;
      }

      setMfaCode("");
      setLocalMessage("MFA code submitted. Waiting for Praktika to reconnect.");
      await loadStatus();
    } finally {
      setMfaSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[440px] max-w-[calc(100vw-2rem)] rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Praktika tools</h2>
          <p className="text-xs text-slate-500">
            Session, referrer sync and queue sync.
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
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${dotClass(currentStatus)}`}
                />
                <h3 className="text-sm font-bold text-slate-950">
                  Praktika: {statusLabel(currentStatus)}
                </h3>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {currentStatus === "connected"
                  ? "Logged in as"
                  : "Last Praktika username"}{" "}
                <span className="font-semibold">
                  {lastUsername || "No username saved"}
                </span>
              </p>

              {currentStatus !== "connected" ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Not currently connected. Reconnect before syncing.
                </p>
              ) : null}

              {shouldShowReconnectWarning ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Reconnect is required before the next sync.
                </p>
              ) : null}

              {session?.message ? (
                <p className="mt-2 text-xs text-slate-500">{session.message}</p>
              ) : null}

              {localMessage ? (
                <p className="mt-2 text-xs font-semibold text-blue-700">
                  {localMessage}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={loadStatus}
                disabled={checking}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {checking ? "Checking..." : "Check"}
              </button>

              <button
                type="button"
                onClick={requestReconnect}
                disabled={refreshSubmitting}
                className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {refreshSubmitting ? "Requesting..." : "Reconnect"}
              </button>
            </div>
          </div>

          {shouldShowCredentialForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div>
                <label className="text-xs font-bold text-amber-950">
                  Praktika username
                </label>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={lastUsername || "Praktika username"}
                  className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-amber-950">
                  Praktika password
                </label>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  placeholder="Praktika password"
                  className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </div>

              <button
                type="button"
                onClick={submitCredentials}
                disabled={credentialsSubmitting}
                className="w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {credentialsSubmitting
                  ? "Submitting credentials..."
                  : "Submit credentials"}
              </button>
            </div>
          ) : null}

          {currentStatus === "waiting_for_mfa" ||
          currentStatus === "refreshing" ||
          currentStatus === "refresh_requested" ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <label className="text-xs font-bold text-blue-950">
                MFA code, if Praktika asks for one
              </label>

              <div className="mt-1 flex gap-2">
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-950"
                />

                <button
                  type="button"
                  onClick={submitMfaCode}
                  disabled={mfaSubmitting}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {mfaSubmitting ? "Sending..." : "Submit"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {finalMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">Praktika message</p>
            <p className="mt-1">{finalMessage}</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-bold text-slate-950">Sync Referrers</h3>
          <p className="text-xs text-slate-500">
            Pull referrer/provider details from Praktika.
          </p>

          <button
            type="button"
            onClick={onSyncReferrers}
            disabled={finalSyncingReferrers}
            className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {finalSyncingReferrers ? "Syncing Referrers..." : "Sync Referrers"}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-bold text-slate-950">Sync Queue</h3>
          <p className="text-xs text-slate-500">
            Pull Praktika letter-icon appointments.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">
              From
              <input
                type="date"
                value={queueFromDate}
                onChange={(event) => updateQueueFromDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs font-bold text-slate-600">
              To
              <input
                type="date"
                value={queueToDate}
                onChange={(event) => updateQueueToDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={onSyncQueue}
            disabled={finalSyncingQueue}
            className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {finalSyncingQueue ? "Syncing Queue..." : "Sync Queue"}
          </button>
        </div>
      </div>
    </div>
  );
}
