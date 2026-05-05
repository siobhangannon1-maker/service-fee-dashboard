"use client";

import { useEffect, useState } from "react";

type GoogleStatus = {
  success: boolean;
  connected: boolean;
  has_access_token?: boolean;
  expires_at?: string | null;
  updated_at?: string | null;
  error?: string;
};

type SyncResult = {
  success: boolean;
  locations_checked?: number;
  reviews_saved?: number;
  error?: string;
  technical_error?: string;
  needsReconnect?: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function GoogleReviewsSyncCard() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);

  async function loadStatus() {
    setStatusLoading(true);

    try {
      const response = await fetch("/api/google-business/status", {
        cache: "no-store",
      });

      const data = (await response.json()) as GoogleStatus;
      setStatus(data);
      setNeedsReconnect(!data.connected);
    } catch {
      setStatus({
        success: false,
        connected: false,
        error: "Failed to load Google Business status",
      });
      setNeedsReconnect(true);
    } finally {
      setStatusLoading(false);
    }
  }

  async function syncGoogleReviews() {
    setSyncing(true);
    setMessage("");
    setError("");
    setNeedsReconnect(false);

    try {
      const response = await fetch("/api/google-review-sync", {
        method: "POST",
      });

      const data = (await response.json()) as SyncResult;

      if (!response.ok || !data.success) {
        setError(data.error || "Google Reviews sync failed.");
        setNeedsReconnect(Boolean(data.needsReconnect));
        await loadStatus();
        return;
      }

      setMessage(
        `Synced ${data.reviews_saved || 0} review(s) across ${data.locations_checked || 0} location(s).`
      );

      await loadStatus();
    } catch {
      setError("Google Reviews sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  const connected = Boolean(status?.connected);
  const statusText = statusLoading
    ? "Checking"
    : connected
      ? "Connected"
      : "Reconnect required";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-slate-900">
              Google Reviews
            </h3>

            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                connected
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
              }`}
            >
              {statusText}
            </span>
          </div>

          <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-700">Last refresh:</span>{" "}
              {statusLoading ? "Checking..." : formatDateTime(status?.updated_at)}
            </p>
            <p>
              <span className="font-semibold text-slate-700">Token expiry:</span>{" "}
              {statusLoading ? "Checking..." : formatDateTime(status?.expires_at)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {needsReconnect ? (
            <a
              href="/api/google-business/connect"
              className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
            >
              Reconnect Google
            </a>
          ) : (
            <button
              type="button"
              onClick={syncGoogleReviews}
              disabled={syncing || statusLoading || !connected}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {syncing ? "Syncing..." : "Sync reviews"}
            </button>
          )}

          <button
            type="button"
            onClick={loadStatus}
            disabled={statusLoading}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {(message || error || needsReconnect) && (
        <div className="mt-3">
          {message && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-100">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-100">
              {error}
            </div>
          )}

          {needsReconnect && !error && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-100">
              Google needs to be reconnected before reviews can be synced.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
