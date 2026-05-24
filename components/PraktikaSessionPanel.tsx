"use client";

import { useEffect, useRef, useState } from "react";

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

type LiveStatus = "not_checked" | "checking" | "connected" | "expired" | "error";

type SessionState = {
  scope?: SessionScope;
  status: SessionStatus;
  message: string;
  currentUrl?: string | null;
  praktikaUsername?: string | null;
  updatedAt?: string;
  refreshRequestedAt?: string | null;
  refreshedAt?: string | null;
  lastUsedAt?: string | null;
  mfaCodeUpdatedAt?: string | null;
};

const STALE_AFTER_MS = 60 * 60 * 1000;

const statusLabelMap: Record<string, string> = {
  not_started: "Not Started",
  connected: "Last Known Connected",
  refreshing: "Refreshing",
  waiting_for_credentials: "Credentials Needed",
  waiting_for_mfa: "MFA Needed",
  refresh_requested: "Refresh Requested",
  expired: "Expired",
  error: "Connection Problem",
};

function getFriendlyMessage(state: SessionState, liveStatus: LiveStatus, scope: SessionScope) {
  if (liveStatus === "checking") return "Checking Praktika live connection...";
  if (liveStatus === "connected") return "Live check passed. Praktika is connected.";
  if (liveStatus === "expired") return "Live check failed. Praktika needs reconnection.";
  if (liveStatus === "error") return "Live check could not confirm the Praktika connection.";

  if (state.status === "connected") {
    return "Praktika was last known to be connected. Use Check Session for a live check.";
  }

  if (state.status === "refreshing") return "Checking Praktika connection...";
  if (state.status === "refresh_requested") return "Connection refresh requested. This should update shortly.";

  if (state.status === "waiting_for_credentials") {
    return scope === "user"
      ? "Enter your Praktika username and password to reconnect."
      : "Practice Praktika credentials are needed.";
  }

  if (state.status === "waiting_for_mfa") return "Praktika requires an MFA code. Enter the code below.";
  if (state.status === "expired") return "Your Praktika session has expired. Reconnect to continue.";
  if (state.status === "error") return state.message || "There was a problem connecting to Praktika.";

  return state.message || "Checking Praktika session...";
}

async function safeJson(res: Response) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API returned non-JSON response (${res.status}). Preview: ${text.slice(0, 120)}`,
    );
  }
}

function formatDate(value?: string | null) {
  if (!value) return "Never";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isStale(value?: string | null) {
  if (!value) return true;

  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return true;

  return Date.now() - time > STALE_AFTER_MS;
}

export default function PraktikaSessionPanel({
  scope = "practice",
  title,
}: {
  scope?: SessionScope;
  title?: string;
}) {
  const [state, setState] = useState<SessionState>({
    status: "not_started",
    message: "Checking Praktika session...",
  });

  const [liveStatus, setLiveStatus] = useState<LiveStatus>("not_checked");
  const [liveMessage, setLiveMessage] = useState("Not checked yet");
  const [liveCheckedAt, setLiveCheckedAt] = useState<string | null>(null);

  const [mfaCode, setMfaCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);

  const autoCheckedRef = useRef(false);

  async function loadStatus() {
    try {
      const res = await fetch(`/api/praktika/session/status?scope=${scope}`, {
        cache: "no-store",
      });

      const json = await safeJson(res);

      const nextState: SessionState = {
        scope: json.scope || scope,
        status: json.status || "error",
        message: json.message || "Unknown Praktika session state.",
        currentUrl: json.currentUrl || null,
        praktikaUsername: json.praktikaUsername || null,
        updatedAt: json.updatedAt || new Date().toISOString(),
        refreshRequestedAt: json.refreshRequestedAt || null,
        refreshedAt: json.refreshedAt || null,
        lastUsedAt: json.lastUsedAt || null,
        mfaCodeUpdatedAt: json.mfaCodeUpdatedAt || null,
      };

      setState(nextState);

      const lastActivity = nextState.lastUsedAt || nextState.refreshedAt;

      if (
        !autoCheckedRef.current &&
        nextState.status === "connected" &&
        isStale(lastActivity)
      ) {
        autoCheckedRef.current = true;
        validateSession({ requestRefresh: false });
      }
    } catch (error: any) {
      console.error("Praktika session status failed:", error);

      setState({
        status: "error",
        message: error?.message || "Could not connect to Praktika session service.",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  useEffect(() => {
    autoCheckedRef.current = false;
    loadStatus();

    const timer = setInterval(loadStatus, 5000);

    return () => clearInterval(timer);
  }, [scope]);

  async function refreshSession() {
    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message || json?.error || `Refresh request failed with status ${res.status}.`,
        );
      }

      setLiveStatus("not_checked");
      setLiveMessage("Refresh requested. Live check will update after reconnect.");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika refresh failed:", error);

      setState({
        status: "error",
        message: error?.message || "Failed to refresh Praktika session.",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function validateSession(options: { requestRefresh?: boolean } = {}) {
    setValidating(true);
    setLiveStatus("checking");
    setLiveMessage("Checking live Praktika connection...");

    try {
      const res = await fetch("/api/praktika/session/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          requestRefresh: options.requestRefresh ?? true,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message || json?.error || `Validation failed with status ${res.status}.`,
        );
      }

      const checkedAt = new Date().toISOString();
      setLiveCheckedAt(checkedAt);

      if (json.connected) {
        setLiveStatus("connected");
        setLiveMessage(json.message || "Live Praktika connection confirmed.");
      } else {
        setLiveStatus("expired");
        setLiveMessage(
          json.message ||
            (json.refreshRequested
              ? "Praktika is not connected. Refresh requested."
              : "Praktika is not connected."),
        );
      }

      await loadStatus();
    } catch (error: any) {
      console.error("Praktika validation failed:", error);

      setLiveStatus("error");
      setLiveCheckedAt(new Date().toISOString());
      setLiveMessage(error?.message || "Failed to validate Praktika session.");

      setState((current) => ({
        ...current,
        status: current.status === "connected" ? "error" : current.status,
        message: error?.message || "Failed to validate Praktika session.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setValidating(false);
    }
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();

    if (!username.trim() || !password) return;

    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message ||
            json?.error ||
            `Credential submission failed with status ${res.status}.`,
        );
      }

      setPassword("");
      setLiveStatus("not_checked");
      setLiveMessage("Credentials submitted. Waiting for reconnect.");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika credential submit failed:", error);

      setState({
        status: "error",
        message: error?.message || "Failed to submit Praktika login details.",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitMfaCode() {
    if (!mfaCode.trim()) return;

    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, code: mfaCode }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message || json?.error || `MFA code submission failed with status ${res.status}.`,
        );
      }

      setMfaCode("");
      setLiveStatus("not_checked");
      setLiveMessage("MFA submitted. Waiting for reconnect.");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika MFA failed:", error);

      setState({
        status: "error",
        message: error?.message || "Failed to submit MFA code.",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  const effectiveHealthy = state.status === "connected" && liveStatus !== "expired" && liveStatus !== "error";

  const tone =
    effectiveHealthy
      ? "border-green-200 bg-green-50 text-green-900"
      : state.status === "error" || state.status === "expired" || liveStatus === "expired" || liveStatus === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : state.status === "waiting_for_mfa" ||
            state.status === "waiting_for_credentials" ||
            state.status === "refresh_requested" ||
            state.status === "refreshing" ||
            liveStatus === "checking"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-gray-200 bg-gray-50 text-gray-900";

  const showCredentials =
    scope === "user" &&
    (state.status !== "connected" || liveStatus === "expired") &&
    state.status !== "refreshing" &&
    state.status !== "refresh_requested" &&
    state.status !== "waiting_for_mfa";

  const showMfa = state.status === "waiting_for_mfa";
  const friendlyMessage = getFriendlyMessage(state, liveStatus, scope);

  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${tone}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold uppercase tracking-[0.14em]">
            {title || (scope === "practice" ? "Practice Praktika Session" : "My Praktika Session")}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold shadow-sm">
              {statusLabelMap[state.status] || state.status}
            </span>

            <span className="rounded-full bg-white/60 px-3 py-1 text-xs">
              {scope === "practice" ? "Practice mode" : "User mode"}
            </span>

            <span className="rounded-full bg-white/70 px-3 py-1 text-xs">
              Live:{" "}
              {liveStatus === "not_checked"
                ? "Not checked"
                : liveStatus === "checking"
                  ? "Checking"
                  : liveStatus === "connected"
                    ? "Connected"
                    : liveStatus === "expired"
                      ? "Expired"
                      : "Error"}
            </span>
          </div>

          <div className="mt-3 text-sm">
            <strong>Connected as:</strong>{" "}
            {state.praktikaUsername ? state.praktikaUsername : "Not connected"}
          </div>

          <p className="mt-2 break-words text-sm">{friendlyMessage}</p>

          <div className="mt-3 grid gap-2 text-xs opacity-80 md:grid-cols-2">
            <div>
              <strong>Last refreshed:</strong> {formatDate(state.refreshedAt)}
            </div>
            <div>
              <strong>Last used:</strong> {formatDate(state.lastUsedAt)}
            </div>
            <div>
              <strong>Live checked:</strong> {formatDate(liveCheckedAt)}
            </div>
            <div>
              <strong>Last status update:</strong> {formatDate(state.updatedAt)}
            </div>
          </div>

          {liveStatus === "error" || liveStatus === "expired" ? (
            <p className="mt-3 text-xs leading-5 opacity-90">{liveMessage}</p>
          ) : null}

          {scope === "user" && showCredentials ? (
            <p className="mt-3 text-xs leading-5 opacity-80">
              Your password is encrypted temporarily, used only to reconnect, and cleared after login.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={() => validateSession({ requestRefresh: true })}
            disabled={busy || validating || state.status === "refreshing"}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 disabled:opacity-50"
          >
            {validating ? "Checking..." : "Check Live"}
          </button>

          <button
            type="button"
            onClick={refreshSession}
            disabled={busy || state.status === "refreshing"}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy || state.status === "refreshing"
              ? "Refreshing..."
              : state.status === "connected"
                ? "Reconnect"
                : "Request Refresh"}
          </button>
        </div>
      </div>

      {showCredentials ? (
        <form onSubmit={submitCredentials} className="mt-4 rounded-xl border border-amber-300 bg-white/70 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium">Praktika username</div>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-gray-900"
                placeholder="Your Praktika username"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-medium">Praktika password</div>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                type="password"
                className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-gray-900"
                placeholder="Your Praktika password"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Reconnect Praktika
          </button>
        </form>
      ) : null}

      {showMfa ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white/70 p-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium">MFA code</div>
            <input
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="Enter MFA code"
              inputMode="numeric"
              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-gray-900"
            />
          </label>

          <button
            type="button"
            onClick={submitMfaCode}
            disabled={busy || !mfaCode.trim()}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Submit MFA code
          </button>
        </div>
      ) : null}
    </section>
  );
}