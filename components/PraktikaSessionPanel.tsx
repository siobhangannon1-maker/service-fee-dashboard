"use client";

import { useEffect, useState } from "react";

type SessionState = {
  status:
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";
  message: string;
  currentUrl?: string;
  updatedAt?: string;
};

async function safeJson(res: Response) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API returned non-JSON response (${res.status}). Preview: ${text.slice(
        0,
        120,
      )}`,
    );
  }
}

export default function PraktikaSessionPanel() {
  const [state, setState] = useState<SessionState>({
    status: "not_started",
    message: "Checking Praktika session...",
  });

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch("/api/praktika/session/status", {
        cache: "no-store",
      });

      if (!res.ok) {
        setState({
          status: "error",
          message: `Could not check Praktika session. API returned ${res.status}.`,
          updatedAt: new Date().toISOString(),
        });

        return;
      }

      const json = await safeJson(res);

      setState({
        status: json.status || "error",
        message: json.message || "Unknown Praktika session state.",
        currentUrl: json.currentUrl,
        updatedAt: json.updatedAt || new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Praktika session status failed:", error);

      setState({
        status: "error",
        message:
          error?.message ||
          "Could not connect to Praktika session service.",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  useEffect(() => {
    loadStatus();

    // Poll less aggressively
    const timer = setInterval(loadStatus, 10000);

    return () => clearInterval(timer);
  }, []);

  async function refreshSession() {
    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/refresh", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(
          `Refresh request failed with status ${res.status}.`,
        );
      }

      await loadStatus();
    } catch (error: any) {
      console.error("Praktika refresh failed:", error);

      setState({
        status: "error",
        message:
          error?.message || "Failed to refresh Praktika session.",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!code.trim()) return;

    setBusy(true);

    try {
      const res = await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        throw new Error(
          `MFA code submission failed with status ${res.status}.`,
        );
      }

      setCode("");
      await loadStatus();
    } catch (error: any) {
      console.error("Praktika MFA failed:", error);

      setState({
        status: "error",
        message:
          error?.message || "Failed to submit MFA code.",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

const statusLabelMap: Record<string, string> = {
  not_started: "Not Started",
  connected: "Connected",
  refreshing: "Refreshing",
  waiting_for_mfa: "Waiting for MFA",
  refresh_requested: "Refresh Requested",
  expired: "Expired",
  error: "Error",
};  

  const tone =
  state.status === "connected"
    ? "border-green-200 bg-green-50 text-green-800"
    : state.status === "error" || state.status === "expired"
      ? "border-red-200 bg-red-50 text-red-800"
      : state.status === "waiting_for_mfa" ||
          state.status === "refresh_requested" ||
          state.status === "refreshing"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-gray-50 text-gray-800";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.14em]">
            Praktika Session
          </div>

          <div className="mt-1 text-sm">
            <strong>Status:</strong> {statusLabelMap[state.status] || state.status}
          </div>

          <p className="mt-1 text-sm break-words">
            {state.message}
          </p>

          {state.currentUrl ? (
            <p className="mt-1 text-xs opacity-75 break-all">
              URL: {state.currentUrl}
            </p>
          ) : null}

          {state.updatedAt ? (
            <p className="mt-1 text-xs opacity-75">
              Last updated:{" "}
              {new Date(state.updatedAt).toLocaleString()}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={refreshSession}
          disabled={busy || state.status === "refreshing"}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy || state.status === "refreshing"
  ? "Refreshing..."
  : "Refresh Praktika Session"}
        </button>
      </div>

      {state.status === "waiting_for_mfa" ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white/70 p-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium">
              Email MFA code
            </div>

            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Enter code from email"
              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-gray-900"
            />
          </label>

          <button
            type="button"
            onClick={submitCode}
            disabled={busy || !code.trim()}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Use this code
          </button>
        </div>
      ) : null}
    </section>
  );
}