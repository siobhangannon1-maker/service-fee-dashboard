"use client";

import { useEffect, useState } from "react";

type PraktikaStatus =
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_credentials"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";

type SessionState = {
  status: PraktikaStatus;
  message: string;
  praktikaUsername?: string | null;
};

async function safeJson(res: Response) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON response: ${text.slice(0, 120)}`);
  }
}

function shouldShowPopup(status: PraktikaStatus) {
  return (
    status === "waiting_for_credentials" ||
    status === "waiting_for_mfa" ||
    status === "expired"
  );
}

export default function PraktikaReconnectPopup() {
  const [session, setSession] = useState<SessionState>({
    status: "not_started",
    message: "Checking Praktika session...",
  });

  const [open, setOpen] = useState(false);
  const [dismissedForStatus, setDismissedForStatus] =
    useState<PraktikaStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch("/api/praktika/session/status?scope=user", {
        cache: "no-store",
      });

      const json = await safeJson(res);

      const next: SessionState = {
        status: json.status || "error",
        message: json.message || "Unknown Praktika session state.",
        praktikaUsername: json.praktikaUsername || null,
      };

      setSession(next);

      if (next.status === "connected") {
        setOpen(false);
        setDismissedForStatus(null);
        setPassword("");
        setMfaCode("");
        return;
      }

      if (
        shouldShowPopup(next.status) &&
        dismissedForStatus !== next.status
      ) {
        setOpen(true);
      }
    } catch {
      // Ignore temporary dev-server reload/network interruptions.
    }
  }

  useEffect(() => {
    loadStatus();

    const timer = window.setInterval(loadStatus, 3000);

    return () => window.clearInterval(timer);
  }, [dismissedForStatus]);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();

    if (!username.trim() || !password) return;

    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Could not reconnect.");
      }

      setPassword("");
      setDismissedForStatus(null);
      await loadStatus();
    } catch (error: any) {
      setSession({
        status: "error",
        message: error?.message || "Could not reconnect Praktika.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitMfaCode(event: React.FormEvent) {
    event.preventDefault();

    if (!mfaCode.trim()) return;

    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "user",
          code: mfaCode,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Could not submit MFA.");
      }

      setMfaCode("");
      setDismissedForStatus(null);
      await loadStatus();
    } catch (error: any) {
      setSession({
        status: "error",
        message: error?.message || "Could not submit MFA code.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const needsMfa = session.status === "waiting_for_mfa";
  const needsCredentials =
    session.status === "waiting_for_credentials" ||
    session.status === "expired" ||
    session.status === "not_started";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Praktika login needed
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Your Praktika connection needs attention before this sync can
              continue.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDismissedForStatus(session.status);
            }}
            className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {session.praktikaUsername ? (
          <p className="mt-3 text-sm text-slate-700">
            Connected as: <strong>{session.praktikaUsername}</strong>
          </p>
        ) : null}

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {needsMfa
            ? "Praktika is asking for an MFA code."
            : "Please reconnect your Praktika account, then run the sync again."}
        </div>

        {needsCredentials ? (
          <form onSubmit={submitCredentials} className="mt-4 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium text-slate-700">
                Praktika username
              </div>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-950"
                placeholder="Your Praktika username"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-medium text-slate-700">
                Praktika password
              </div>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                type="password"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-950"
                placeholder="Your Praktika password"
              />
            </label>

            <button
              type="submit"
              disabled={busy || !username.trim() || !password}
              className="w-full rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Reconnecting..." : "Reconnect Praktika"}
            </button>
          </form>
        ) : null}

        {needsMfa ? (
          <form onSubmit={submitMfaCode} className="mt-4 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium text-slate-700">
                MFA code
              </div>
              <input
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-950"
                placeholder="Enter MFA code"
              />
            </label>

            <button
              type="submit"
              disabled={busy || !mfaCode.trim()}
              className="w-full rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Submitting..." : "Submit MFA code"}
            </button>
          </form>
        ) : null}

        <p className="mt-4 text-xs leading-5 text-slate-500">
          This popup will close automatically once Praktika reconnects.
        </p>
      </div>
    </div>
  );
}