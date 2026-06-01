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

const STATUS_POLL_MS =30000;
const RECONNECT_STATUSES: SessionStatus[] = ["refresh_requested", "refreshing"];

function isReconnectStatus(status: SessionStatus) {
  return RECONNECT_STATUSES.includes(status);
}

function isActionNeededStatus(status: SessionStatus) {
  return (
    status === "waiting_for_credentials" ||
    status === "waiting_for_mfa" ||
    status === "not_started" ||
    status === "expired" ||
    status === "error"
  );
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
    return new Date(value).toLocaleString("en-AU");
  } catch {
    return value;
  }
}

function minutesSince(value?: string | null) {
  if (!value) return null;

  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;

  return Math.max(0, Math.round((Date.now() - time) / 60_000));
}

function friendlyRelativeTime(value?: string | null) {
  const minutes = minutesSince(value);
  if (minutes === null) return "Not yet";
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function getDisplayState(state: SessionState, liveStatus: LiveStatus) {
  if (liveStatus === "checking" || isReconnectStatus(state.status)) {
    return {
      label: "Reconnecting",
      tone: "border-blue-200 bg-blue-50 text-blue-950",
      dot: "bg-blue-500",
      headline: "Reconnecting to Praktika",
      message:
        state.message ||
        "Reconnecting to Praktika automatically. Keep the helper browser open.",
    };
  }

  if (state.status === "waiting_for_mfa") {
    return {
      label: "MFA needed",
      tone: "border-amber-200 bg-amber-50 text-amber-950",
      dot: "bg-amber-500",
      headline: "Praktika needs an MFA code",
      message:
        "Enter the code from Authenticator below and reconnection will continue automatically.",
    };
  }

  if (
    state.status === "waiting_for_credentials" ||
    state.status === "not_started" ||
    state.status === "expired"
  ) {
    return {
      label: "Login needed",
      tone: "border-amber-200 bg-amber-50 text-amber-950",
      dot: "bg-amber-500",
      headline: "Praktika login needed",
      message:
        state.status === "expired"
          ? "Your Praktika session has expired. Enter your login details to reconnect."
          : "Enter your Praktika username and password to connect.",
    };
  }

  if (state.status === "error" || liveStatus === "error" || liveStatus === "expired") {
    return {
      label: "Attention needed",
      tone: "border-red-200 bg-red-50 text-red-950",
      dot: "bg-red-500",
      headline: "Praktika needs attention",
      message: state.message || "Could not confirm the Praktika connection.",
    };
  }

  if (state.status === "connected" || liveStatus === "connected") {
    return {
      label: "Connected",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      dot: "bg-emerald-500",
      headline: "Praktika connected",
      message: "Praktika successfully connected.",
    };
  }

  return {
    label: "Checking",
    tone: "border-slate-200 bg-slate-50 text-slate-950",
    dot: "bg-slate-400",
    headline: "Checking Praktika",
    message: state.message || "Checking your Praktika connection.",
  };
}

export default function PraktikaSessionPanel({
  scope = "user",
  title = "My Praktika Session",
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
  const [showAdvanced, setShowAdvanced] = useState(false);

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

      if (nextState.status === "connected") {
        setLiveStatus("connected");
        setLiveMessage(
          nextState.message || "Praktika browser and API are connected.",
        );
      }

      if (
        nextState.status === "waiting_for_credentials" ||
        nextState.status === "waiting_for_mfa" ||
        nextState.status === "expired" ||
        nextState.status === "error"
      ) {
        setLiveStatus("not_checked");
      }
    } catch (error: any) {
      console.error("Praktika session status failed:", error);

      setState({
        status: "error",
        message:
          error?.message || "Could not connect to Praktika session service.",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  useEffect(() => {
    loadStatus();

    const timer = window.setInterval(loadStatus, STATUS_POLL_MS);

    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          json?.message ||
            json?.error ||
            `Refresh request failed with status ${res.status}.`,
        );
      }

      setLiveStatus("checking");
      setLiveMessage("Reconnect requested. Status will update shortly.");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika refresh failed:", error);

      setState((current) => ({
        ...current,
        status: "error",
        message: error?.message || "Failed to refresh Praktika session.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusy(false);
    }
  }

  async function validateSession(
    options: { requestRefresh?: boolean; silent?: boolean } = {},
  ) {
    if (validating) return;

    setValidating(true);

    if (!options.silent) {
      setLiveStatus("checking");
      setLiveMessage("Checking live Praktika connection...");
    }

    try {
      const res = await fetch("/api/praktika/session/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          requestRefresh: options.requestRefresh ?? false,
        }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message ||
            json?.error ||
            `Validation failed with status ${res.status}.`,
        );
      }

      setLiveCheckedAt(new Date().toISOString());

      if (json.connected) {
        setLiveStatus("connected");
        setLiveMessage(json.message || "Live Praktika connection confirmed.");
      } else if (json.refreshRequested) {
        setLiveStatus("checking");
        setLiveMessage("Praktika reconnect requested.");
      } else {
        setLiveStatus("expired");
        setLiveMessage(json.message || "Praktika is not connected.");
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
      setLiveStatus("checking");
      setLiveMessage("Login details received. Reconnecting to Praktika...");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika credential submit failed:", error);

      setState((current) => ({
        ...current,
        status: "error",
        message: error?.message || "Failed to submit Praktika login details.",
        updatedAt: new Date().toISOString(),
      }));
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, code: mfaCode }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          json?.message ||
            json?.error ||
            `MFA code submission failed with status ${res.status}.`,
        );
      }

      setMfaCode("");
      setLiveStatus("checking");
      setLiveMessage("MFA submitted. Finishing Praktika reconnect...");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika MFA failed:", error);

      setState((current) => ({
        ...current,
        status: "error",
        message: error?.message || "Failed to submit MFA code.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusy(false);
    }
  }

  const display = getDisplayState(state, liveStatus);

  const showCredentials =
    scope === "user" &&
    (state.status === "waiting_for_credentials" ||
      state.status === "not_started" ||
      state.status === "expired" ||
      state.status === "error") &&
    !isReconnectStatus(state.status) &&
    liveStatus !== "checking";

  const showMfa = state.status === "waiting_for_mfa";

  const isConnected =
    state.status === "connected" &&
    liveStatus !== "expired" &&
    liveStatus !== "error";

  const isBusyState =
    busy ||
    validating ||
    isReconnectStatus(state.status) ||
    liveStatus === "checking";

  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${display.tone}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold uppercase tracking-[0.14em]">
              {title}
            </div>

            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold shadow-sm">
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${display.dot}`} />
              {display.label}
            </span>
          </div>

          <h2 className="mt-3 text-lg font-bold">{display.headline}</h2>
          <p className="mt-1 break-words text-sm leading-6">{display.message}</p>

          <div className="mt-3 grid gap-2 text-xs opacity-80 md:grid-cols-2">
            <div>
              <strong>Logged in as:</strong>{" "}
              {state.praktikaUsername ? state.praktikaUsername : "Not connected"}
            </div>
            <div>
              <strong>Last successful connection:</strong>{" "}
              {friendlyRelativeTime(state.refreshedAt || state.lastUsedAt)}
            </div>
          </div>

          {isConnected ? (
            <p className="mt-3 text-xs leading-5 opacity-80">
              Keep the local Praktika helper browser open during the day for the most stable connection.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          {isActionNeededStatus(state.status) && !showCredentials && !showMfa ? (
            <button
              type="button"
              onClick={refreshSession}
              disabled={isBusyState}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isBusyState ? "Reconnecting..." : "Reconnect Praktika"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setShowAdvanced((current) => !current)}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300"
          >
            {showAdvanced ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {showCredentials ? (
        <form
          onSubmit={submitCredentials}
          className="mt-4 rounded-xl border border-amber-300 bg-white/70 p-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium">Praktika username</div>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-slate-900"
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
                className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Your Praktika password"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Connecting..." : "Connect Praktika"}
          </button>
        </form>
      ) : null}

      {showMfa ? (
        <form
          onSubmit={submitMfaCode}
          className="mt-4 rounded-xl border border-amber-300 bg-white/70 p-3"
        >
          <label className="block">
            <div className="mb-1 text-xs font-medium">MFA code</div>
            <input
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="Enter MFA code"
              inputMode="numeric"
              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !mfaCode.trim()}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Submitting..." : "Submit MFA code"}
          </button>
        </form>
      ) : null}

      {showAdvanced ? (
        <div className="mt-4 rounded-xl border border-white/70 bg-white/60 p-3 text-xs text-slate-800">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <strong>Raw status:</strong> {state.status}
            </div>
            <div>
              <strong>Live status:</strong> {liveStatus}
            </div>
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

          {state.currentUrl ? (
            <div className="mt-2 break-words">
              <strong>Helper URL:</strong> {state.currentUrl}
            </div>
          ) : null}

          {liveMessage ? <p className="mt-2 break-words opacity-80">{liveMessage}</p> : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => validateSession({ requestRefresh: false })}
              disabled={isBusyState}
              className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 ring-1 ring-inset ring-slate-300 disabled:opacity-50"
            >
              {validating ? "Checking..." : "Check now"}
            </button>

            <button
              type="button"
              onClick={refreshSession}
              disabled={isBusyState}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy || isReconnectStatus(state.status) ? "Reconnecting..." : "Force reconnect"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}