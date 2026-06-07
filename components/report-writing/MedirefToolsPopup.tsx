"use client";

import { useEffect, useState } from "react";

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
  updatedAt?: string | null;
  refreshRequestedAt?: string | null;
  refreshedAt?: string | null;
  lastUsedAt?: string | null;
  mfaCodeUpdatedAt?: string | null;
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
    status === "expired" ||
    status === "not_started"
  ) {
    return "bg-amber-500";
  }

  if (status === "error") return "bg-red-500";

  return "bg-slate-400";
}

export default function MedirefToolsPopup({
  open,
  onOpenChange,
  onClose,
}: MedirefToolsPopupProps) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const currentStatus = session?.status || "not_started";
  const lastEmail = session?.medirefEmail || session?.email || "";
  const isConnected = currentStatus === "connected" || Boolean(session?.connected);
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

  async function loadStatus() {
    try {
      setChecking(true);

      const response = await fetch("/api/mediref/session/status?scope=practice", {
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
          data.error || data.message || "Could not request MediRef reconnect.",
        );
        return;
      }

      setLocalMessage("Reconnect requested. Keep the local MediRef watcher open.");
      await loadStatus();
    } finally {
      setRefreshSubmitting(false);
    }
  }

  async function submitCredentials() {
    if (!email.trim() || !password.trim()) {
      setLocalMessage("Enter both MediRef email and password.");
      return;
    }

    setLocalMessage(null);
    setCredentialsSubmitting(true);

    try {
      const response = await fetch("/api/mediref/session/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "practice",
          email: email.trim(),
          username: email.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false || data.ok === false) {
        setLocalMessage(
          data.error || data.message || "Could not submit MediRef credentials.",
        );
        return;
      }

      setPassword("");
      setLocalMessage(
        "Credentials submitted. The local MediRef helper will continue the login.",
      );

      await loadStatus();
    } finally {
      setCredentialsSubmitting(false);
    }
  }

  async function submitMfaCode() {
    const code = mfaCode.replace(/\D/g, "").trim();

    if (!code) {
      setLocalMessage("Enter the MFA code from MediRef.");
      return;
    }

    setLocalMessage(null);
    setMfaSubmitting(true);

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
          data.error || data.message || "Could not submit MFA code.",
        );
        return;
      }

      setMfaCode("");
      setLocalMessage("MFA code submitted. Waiting for MediRef to reconnect.");
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
          <h2 className="text-lg font-bold text-slate-950">MediRef tools</h2>
          <p className="text-xs text-slate-500">
            Practice MediRef session and delivery connection.
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
                  MediRef: {statusLabel(currentStatus)}
                </h3>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {isConnected ? "Logged in as" : "Last MediRef email"}{" "}
                <span className="font-semibold">
                  {lastEmail || "No email saved"}
                </span>
              </p>

              {currentStatus !== "connected" ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Not currently connected. Reconnect before sending via MediRef.
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
                  MediRef email
                </label>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={lastEmail || "MediRef email"}
                  className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-amber-950">
                  MediRef password
                </label>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  placeholder="MediRef password"
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
                MFA code, if MediRef asks for one
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

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-bold text-slate-950">What happens next</h3>
          <p className="mt-1 text-xs text-slate-500">
            The Mac Mini MediRef watcher uses this practice session to keep
            MediRef logged in and process future MediRef delivery jobs.
          </p>
        </div>
      </div>
    </div>
  );
}