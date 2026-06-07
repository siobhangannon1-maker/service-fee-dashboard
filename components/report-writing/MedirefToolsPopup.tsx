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
  if (status === "waiting_for_mfa") return "Code needed";
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

function formatTime(value?: string | null) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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
  const isConnected =
    currentStatus === "connected" || Boolean(session?.connected);

  const shouldShowCredentialForm =
    !isConnected &&
    ["waiting_for_credentials", "expired", "error", "not_started"].includes(
      currentStatus,
    );

  const shouldShowMfaForm =
    currentStatus === "waiting_for_mfa" ||
    currentStatus === "refreshing" ||
    currentStatus === "refresh_requested";

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

        const returnedEmail = data.medirefEmail || data.email || "";
        if (returnedEmail && !email) {
          setEmail(returnedEmail);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      setLocalMessage(
        "Reconnect requested. Keep the Mac Mini MediRef watcher running.",
      );
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
        return;
      }

      setMfaCode("");
      setLocalMessage("Code submitted. Waiting for MediRef to reconnect.");
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
                  className={`h-3 w-3 rounded-full ${dotClass(currentStatus)}`}
                />
                <h3 className="text-sm font-bold text-slate-950">
                  MediRef: {statusLabel(currentStatus)}
                </h3>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {isConnected ? "Logged in as" : "MediRef account"}{" "}
                <span className="font-semibold">
                  {lastEmail || "No email saved"}
                </span>
              </p>

              {isConnected ? (
                <p className="mt-2 text-xs font-semibold text-emerald-700">
                  MediRef is connected. Delivery jobs can be processed by the
                  Mac Mini helper.
                </p>
              ) : (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Not currently connected. Reconnect before sending via MediRef.
                </p>
              )}

              {session?.message ? (
                <p className="mt-2 break-words text-xs text-slate-500">
                  {session.message}
                </p>
              ) : null}

              {session?.currentUrl ? (
                <p className="mt-2 break-all text-[11px] text-slate-400">
                  Current page: {session.currentUrl}
                </p>
              ) : null}

              {session?.refreshedAt || session?.updatedAt ? (
                <p className="mt-2 text-[11px] text-slate-400">
                  Last update:{" "}
                  {formatTime(session.refreshedAt || session.updatedAt)}
                </p>
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
        </div>
                {shouldShowCredentialForm && (
          <div className="rounded-2xl border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">
              MediRef login
            </h3>

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
                  onChange={(e) => setEmail(e.target.value)}
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
                  onChange={(e) => setPassword(e.target.value)}
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
                {credentialsSubmitting
                  ? "Submitting..."
                  : "Save credentials"}
              </button>
            </div>
          </div>
        )}

        {shouldShowMfaForm && (
          <div className="rounded-2xl border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">
              Verification code
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Enter the code sent by MediRef. The helper on the Mac Mini will
              continue the login automatically.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="Verification code"
              />

              <button
                type="button"
                onClick={submitMfaCode}
                disabled={mfaSubmitting}
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {mfaSubmitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
          <h3 className="text-sm font-bold text-blue-950">
            Mac Mini helper
          </h3>

          <div className="mt-2 space-y-1 text-xs text-blue-900">
            <p>
              The MediRef watcher should run on the Mac Mini:
            </p>

            <pre className="mt-2 overflow-x-auto rounded-xl bg-white p-2 text-[11px]">
{`npm run watch:mediref-refresh`}
            </pre>

            <p>
              Keep this watcher running continuously so referral delivery and
              session refreshes can be processed automatically.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">
            Troubleshooting
          </h3>

          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
            <li>
              If the helper keeps opening the emailed-code screen, click
              <strong> Login with password </strong>
              once.
            </li>

            <li>
              Make sure MEDIREF_EMAIL and MEDIREF_PASSWORD exist in the Mac
              Mini .env.local file.
            </li>

            <li>
              If the helper is stuck, press Reconnect and check the watcher
              terminal.
            </li>

            <li>
              Only one MediRef practice session is required because your clinic
              uses a shared MediRef account.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}