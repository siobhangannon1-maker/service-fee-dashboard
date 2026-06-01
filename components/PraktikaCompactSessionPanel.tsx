"use client";

import { useEffect, useState } from "react";

type SessionScope = "practice" | "user";

type SessionStatus =
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_credentials"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";

type SessionState = {
  status: SessionStatus;
  message: string;
  praktikaUsername?: string | null;
  refreshedAt?: string | null;
  lastUsedAt?: string | null;
};

const STATUS_POLL_MS = 30000;

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200));
  }
}

function isConnected(status: SessionStatus) {
  return status === "connected";
}

function needsLogin(status: SessionStatus) {
  return (
    status === "waiting_for_credentials" ||
    status === "not_started" ||
    status === "expired" ||
    status === "error"
  );
}

function statusLabel(status: SessionStatus) {
  if (status === "connected") return "Connected";
  if (status === "waiting_for_mfa") return "MFA needed";
  if (status === "refresh_requested" || status === "refreshing") return "Reconnecting";
  if (needsLogin(status)) return "Login needed";
  return "Checking";
}

export default function PraktikaCompactSessionPanel({
  scope = "user",
}: {
  scope?: SessionScope;
}) {
  const [state, setState] = useState<SessionState>({
    status: "not_started",
    message: "Checking Praktika...",
  });

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    const res = await fetch(`/api/praktika/session/status?scope=${scope}`, {
      cache: "no-store",
    });
    const json = await safeJson(res);

    setState({
      status: json.status || "error",
      message: json.message || "Unknown Praktika state.",
      praktikaUsername: json.praktikaUsername || null,
      refreshedAt: json.refreshedAt || null,
      lastUsedAt: json.lastUsedAt || null,
    });

    if (json.praktikaUsername && !username) {
      setUsername(json.praktikaUsername);
    }
  }

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function reconnect() {
    setBusy(true);

    try {
      await fetch("/api/praktika/session/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });

      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json.message || json.error || "Could not submit login.");
      }

      setPassword("");
      await loadStatus();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, code: mfaCode }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json.message || json.error || "Could not submit MFA.");
      }

      setMfaCode("");
      await loadStatus();
    } catch (error) {
      alert(error instanceof Error ? error.message : "MFA failed.");
    } finally {
      setBusy(false);
    }
  }

  const connected = isConnected(state.status);
  const showCredentials = needsLogin(state.status);
  const showMfa = state.status === "waiting_for_mfa";

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="text-sm font-semibold text-slate-900">
                Praktika: {statusLabel(state.status)}
              </span>
            </div>

            <div className="mt-1 truncate text-xs text-slate-500">
              {state.praktikaUsername
                ? `Logged in as ${state.praktikaUsername}`
                : state.message}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Praktika Session
                </h2>
                <p className="mt-1 text-sm text-slate-500">{state.message}</p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border px-3 py-2 text-sm"
              >
                Close
              </button>
            </div>

            <div
              className={`mt-4 rounded-2xl border p-4 ${
                connected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <div className="font-semibold">{statusLabel(state.status)}</div>
              <div className="mt-1 text-sm">
                Connected as: {state.praktikaUsername || "Not connected"}
              </div>
            </div>

            {showCredentials && (
              <form
                onSubmit={submitCredentials}
                className="mt-4 rounded-2xl border border-slate-200 p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">
                      Praktika username
                    </div>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      placeholder="Username"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-1 text-sm font-medium">
                      Praktika password
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      placeholder="Password"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={busy || !username || !password}
                  className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Connecting..." : "Connect Praktika"}
                </button>
              </form>
            )}

            {showMfa && (
              <form
                onSubmit={submitMfa}
                className="mt-4 rounded-2xl border border-slate-200 p-4"
              >
                <label className="block">
                  <div className="mb-1 text-sm font-medium">MFA code</div>
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    placeholder="Enter MFA code"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !mfaCode}
                  className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Submitting..." : "Submit MFA"}
                </button>
              </form>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={reconnect}
                disabled={busy}
                className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Reconnecting..." : "Force reconnect"}
              </button>

              <button
                type="button"
                onClick={loadStatus}
                className="rounded-xl border px-4 py-2 text-sm font-semibold"
              >
                Refresh status
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}