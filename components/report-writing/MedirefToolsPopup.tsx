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
  updatedAt?: string | null;
  refreshRequestedAt?: string | null;
  refreshedAt?: string | null;
  lastUsedAt?: string | null;
  mfaCodeUpdatedAt?: string | null;
};

type ConnectionState = "connected" | "connecting" | "disconnected";

function getConnectionState(status?: string, connected?: boolean): ConnectionState {
  if (connected || status === "connected") return "connected";

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
  if (state === "connecting") return "Connection underway";
  return "No connection";
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
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const [displayStatus, setDisplayStatus] = useState("not_started");
  const [displayConnected, setDisplayConnected] = useState(false);
  const failedStatusChecksRef = useRef(0);
  const pendingStatusRef = useRef<string | null>(null);
  const pendingConnectedRef = useRef(false);
  const pendingStatusCountRef = useRef(0);

  const currentStatus = displayStatus;
  const lastEmail = session?.medirefEmail || session?.email || email || "";
  const currentConnectionState = getConnectionState(
    currentStatus,
    displayConnected,
  );
  const isConnected = currentConnectionState === "connected";
  const isConnecting = currentConnectionState === "connecting";

  const shouldShowCredentialForm =
    currentConnectionState === "disconnected" &&
    ["waiting_for_credentials", "expired", "error", "not_started"].includes(
      currentStatus,
    );

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
    setDisplayConnected(Boolean(connected || status === "connected"));
  }

  function handleStableStatusUpdate(data: SessionStatus | null) {
    if (!data) return;

    const nextStatus = data.status || "not_started";
    const nextConnected = Boolean(data.connected || nextStatus === "connected");
    const nextState = getConnectionState(nextStatus, nextConnected);
    const currentState = getConnectionState(displayStatus, displayConnected);

    // Connected is a positive signal. Show it immediately.
    if (nextState === "connected") {
      failedStatusChecksRef.current = 0;
      pendingStatusRef.current = null;
      pendingStatusCountRef.current = 0;
      commitDisplayStatus(nextStatus, nextConnected);
      return;
    }

    // Connecting is also useful for staff to see quickly, but do not downgrade
    // from connected unless we see the same non-connected state more than once.
    if (currentState !== "connected" && nextState === "connecting") {
      failedStatusChecksRef.current = 0;
      pendingStatusRef.current = null;
      pendingStatusCountRef.current = 0;
      commitDisplayStatus(nextStatus, nextConnected);
      return;
    }

    const pendingKey = `${nextStatus}:${nextConnected ? "1" : "0"}`;

    if (pendingStatusRef.current === pendingKey) {
      pendingStatusCountRef.current += 1;
    } else {
      pendingStatusRef.current = pendingKey;
      pendingConnectedRef.current = nextConnected;
      pendingStatusCountRef.current = 1;
    }

    const requiredConfirmations = currentState === "connected" ? 4 : 2;

    if (pendingStatusCountRef.current >= requiredConfirmations) {
      failedStatusChecksRef.current = 0;
      commitDisplayStatus(nextStatus, pendingConnectedRef.current);
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

      if (!response.ok || !data) {
        failedStatusChecksRef.current += 1;

        // Do not turn red on a single missed status check. This prevents flicker.
        if (failedStatusChecksRef.current >= 4) {
          commitDisplayStatus("error", false);
        }

        return;
      }

      setSession(data);

      const returnedEmail = data.medirefEmail || data.email || "";
      if (returnedEmail && !email) {
        setEmail(returnedEmail);
      }

      handleStableStatusUpdate(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, displayStatus, displayConnected]);

  async function requestReconnect() {
    setLocalMessage(null);
    setRefreshSubmitting(true);
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

      setLocalMessage("Connect requested. Keep the Mac Mini MediRef watcher running.");
      await loadStatus();
    } finally {
      setRefreshSubmitting(false);
    }
  }

  async function submitCredentials() {
    if (!email.trim() || !password.trim()) {
      setLocalMessage("Enter both the MediRef email and password.");
      return;
    }

    setLocalMessage(null);
    setCredentialsSubmitting(true);
    commitDisplayStatus("refresh_requested", false);

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
        commitDisplayStatus("error", false);
        return;
      }

      setPassword("");
      setLocalMessage(
        "Credentials submitted. The Mac Mini helper will continue the MediRef login.",
      );

      await loadStatus();
    } finally {
      setCredentialsSubmitting(false);
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

              <p className="mt-2 text-xs text-slate-500">
                {isConnected ? "Logged in as" : "MediRef account"}{" "}
                <span className="font-semibold">
                  {lastEmail || "No email saved"}
                </span>
              </p>

              {currentConnectionState === "disconnected" ? (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Not currently connected. Connect before sending via MediRef.
                </p>
              ) : null}

              {localMessage ? (
                <p className="mt-2 text-xs font-semibold text-blue-700">
                  {localMessage}
                </p>
              ) : null}
            </div>

            {currentConnectionState === "disconnected" ? (
              <button
                type="button"
                onClick={requestReconnect}
                disabled={refreshSubmitting}
                className="shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {refreshSubmitting ? "Connecting..." : "Connect"}
              </button>
            ) : null}
          </div>
        </div>

        {shouldShowCredentialForm ? (
          <div className="rounded-2xl border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">MediRef login</h3>

            <p className="mt-1 text-xs text-slate-500">
              If your helper opens the MediRef login screen that asks for an
              emailed code first, click <strong>Login with password</strong>.
              The helper will then use the email/password stored here.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="email@example.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Password
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Password"
                />
              </div>

              <button
                type="button"
                onClick={submitCredentials}
                disabled={credentialsSubmitting}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {credentialsSubmitting ? "Submitting..." : "Save credentials"}
              </button>
            </div>
          </div>
        ) : null}

        {shouldShowMfaForm ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3">
            <h3 className="text-sm font-bold text-orange-950">
              Verification code
            </h3>

            <p className="mt-1 text-xs text-orange-900">
              Enter the code sent by MediRef. The helper on the Mac Mini will
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
