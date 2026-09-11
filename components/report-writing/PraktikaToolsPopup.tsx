"use client";

import { currentStatus as cachedStatus, useStatusExpiry } from "@/lib/praktika/use-status-expiry";

import { useRef, useEffect, useMemo, useState } from "react";

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
  connected?: boolean;
  helperHeartbeatAt?: string | null;
  authenticatedAt?: string | null;
  message?: string | null;
  praktikaUsername?: string | null;
  praktika_username?: string | null;
  username?: string | null;
  hasCookie?: boolean;
  has_cookie?: boolean;
};

type ConnectionDisplayState = "loading" | "checking" | "rechecking" | "connected" | "connecting" | "idle" | "disconnected" | "login_required" | "mfa_required";

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getInclusiveDateRangeDays(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }

  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function connectionState(
  status: string,
  busy: boolean,
): ConnectionDisplayState {
  if (busy) return "connecting";
  if (status === "loading") return "loading";
  if (status === "rechecking_connection") return "rechecking";
  if (status === "checking_connection") return "checking";
  if (status === "waiting_for_credentials") return "login_required";
  if (status === "waiting_for_mfa") return "mfa_required";
  if (status === "idle") return "idle";
  if (status === "connected") return "connected";

  if (
    status === "refreshing" ||
    status === "refresh_requested"
  ) {
    return "connecting";
  }

  return "disconnected";
}

function connectionLabel(state: ConnectionDisplayState) {
  if (state === "loading") return "Loading…";
  if (state === "rechecking") return "Rechecking connection";
  if (state === "checking") return "Checking connection";
  if (state === "login_required") return "Login required";
  if (state === "mfa_required") return "Waiting for MFA";
  if (state === "connected") return "Connected";
  if (state === "connecting") return "Connecting";
  if (state === "idle") return "Not connected";
  return "Not connected";
}

function dotClass(state: ConnectionDisplayState) {
  if (state === "connected") return "bg-emerald-500";
  if (state === "connecting" || state === "rechecking") return "bg-orange-500";
  if (state === "idle") return "bg-slate-400";
  return "bg-slate-400";
}

export default function PraktikaToolsPopup(props: PraktikaToolsPopupProps) {
  // Keep cached operational status across popup openings.
  return <PraktikaToolsPopupContent {...props} />;
}

function PraktikaToolsPopupContent({
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
}: PraktikaToolsPopupProps) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [displayStatus, setDisplayStatus] = useState("loading");
  const [, setChecking] = useState(false);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const refreshSubmitting = false;
  const [credentialsRequested, setCredentialsRequested] = useState(false);
  const credentialRequestActive = useRef(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const currentStatus = displayStatus === "connected" ? cachedStatus(session) : displayStatus;
  const lastUsername =
    session?.praktikaUsername ||
    session?.praktika_username ||
    session?.username ||
    "";

  const finalSyncingQueue = Boolean(loadingQueue ?? syncingQueue);
  const finalSyncingReferrers = Boolean(loadingReferrers ?? syncingReferrers);
  const finalMessage = message ?? preSyncMessage ?? null;

  const isBusy =
    credentialsSubmitting ||
    mfaSubmitting ||
    refreshSubmitting ||
    finalSyncingQueue ||
    finalSyncingReferrers;

  const currentConnectionState: ConnectionDisplayState =
    connectionState(currentStatus, credentialsSubmitting || mfaSubmitting || refreshSubmitting);

  const shouldShowCredentialForm = !credentialsSubmitting && !mfaSubmitting &&
    (currentStatus === "waiting_for_credentials" ||
      (credentialsRequested && ["disconnected", "idle"].includes(currentConnectionState)));

  const shouldShowMfaBox = currentStatus === "waiting_for_mfa";

  const maxQueueToDate = useMemo(() => {
    if (!queueFromDate) return "";
    return addDays(queueFromDate, 6);
  }, [queueFromDate]);

  function closePopup() {
    setPassword("");
    setCredentialsRequested(false);
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
    } else if (setQueueFromDate) {
      setQueueFromDate(value);
    }

    const maxToDate = addDays(value, 6);

    if (queueToDate && maxToDate && queueToDate > maxToDate) {
      if (onQueueToDateChange) {
        onQueueToDateChange(maxToDate);
      } else if (setQueueToDate) {
        setQueueToDate(maxToDate);
      }

      setLocalMessage("Queue sync range capped to 7 days.");
    }
  }

  function updateQueueToDate(value: string) {
    if (queueFromDate) {
      const maxToDate = addDays(queueFromDate, 6);

      if (maxToDate && value > maxToDate) {
        if (onQueueToDateChange) {
          onQueueToDateChange(maxToDate);
        } else if (setQueueToDate) {
          setQueueToDate(maxToDate);
        }

        setLocalMessage("Queue sync range capped to 7 days.");
        return;
      }
    }

    if (onQueueToDateChange) {
      onQueueToDateChange(value);
      return;
    }

    if (setQueueToDate) {
      setQueueToDate(value);
    }
  }

  const armStatusExpiry = useStatusExpiry(status => { setDisplayStatus(current => ["connected", "checking_connection", "rechecking_connection"].includes(current) ? status : current); }, true, true);
  const statusRequest = useRef(0);

  async function loadStatus() {
    if (credentialRequestActive.current) return;
    const requestId = ++statusRequest.current;
    // Finish before the next five-second poll; late results cannot restore green.
    const signal = AbortSignal.timeout(4000);
    try {
      setChecking(true);

      const response = await fetch("/api/praktika/session/status?scope=user", {
        method: "GET",
        cache: "no-store",
        signal,
      });

      const data = await response.json().catch(() => null);
      if (requestId !== statusRequest.current) return;
      if (signal.aborted) throw new Error("Status request expired");

      if (!response.ok || !data) {
        setDisplayStatus("error");
        return;
      }
      setSession(data);
      setUsername(current => current || data.praktikaUsername || data.praktika_username || data.username || "");
      // Backend derived truth takes effect immediately; never retain stale green.
      setDisplayStatus(armStatusExpiry(data));
      if (data.connected === true) { setLocalMessage(null); setPassword(""); }
    } catch {
      if (requestId !== statusRequest.current) return;
      setDisplayStatus("error");
    } finally {
      if (requestId === statusRequest.current) setChecking(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    loadStatus();

    const interval = window.setInterval(() => {
      loadStatus();
    }, 5000);

    return () => { ++statusRequest.current; window.clearInterval(interval); };
  }, [open]);

  function requestReconnect() {
    setLocalMessage(null);
    setUsername(username || lastUsername);
    setPassword("");
    setCredentialsRequested(true);
  }

  async function submitCredentials() {
    if (!username.trim() || !password.trim()) {
      setLocalMessage("Enter both Praktika username and password.");
      return;
    }

    setLocalMessage(null);
    ++statusRequest.current;
    credentialRequestActive.current = true;
    setCredentialsRequested(false);
    setCredentialsSubmitting(true);
    setDisplayStatus("refreshing");

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

      if (!response.ok || data.success === false || data.ok === false) {
        setLocalMessage(
          data.error || data.message || "Could not connect to Praktika.",
        );
        return;
      }

      const refreshResponse = await fetch("/api/praktika/session/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "user",
          force: true,
        }),
      });

      const refreshData = await refreshResponse.json().catch(() => ({}));

      if (
        !refreshResponse.ok ||
        refreshData.success === false ||
        refreshData.ok === false
      ) {
        setLocalMessage(
          refreshData.error ||
            refreshData.message ||
            "Credentials were saved, but Praktika could not start connecting.",
        );
        return;
      }

      setPassword("");
      setLocalMessage(null);
    } catch {
      setLocalMessage("Could not submit credentials. Please try again.");
    } finally {
      setPassword("");
      credentialRequestActive.current = false;
      setCredentialsSubmitting(false);
      await loadStatus();
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
    setDisplayStatus("refreshing");

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

      if (!response.ok || data.success === false || data.ok === false) {
        setLocalMessage(data.error || data.message || "Could not submit MFA code.");
        return;
      }

      setMfaCode("");
      setLocalMessage("MFA code submitted. Waiting for Praktika to connect.");
      await loadStatus();
    } finally {
      setMfaSubmitting(false);
    }
  }

  async function syncQueueWithDateLimit() {
    const rangeDays = getInclusiveDateRangeDays(queueFromDate, queueToDate);

    if (!rangeDays || rangeDays < 1) {
      setLocalMessage("Choose a valid queue sync date range.");
      return;
    }

    if (rangeDays > 7) {
      setLocalMessage("Queue sync range must be 7 days or less.");
      return;
    }

    await onSyncQueue();
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
                  className={`h-3 w-3 rounded-full ${dotClass(
                    currentConnectionState,
                  )}`}
                />
                <h3 className="text-sm font-bold text-slate-950">
                  Praktika: {currentStatus === "waiting_for_mfa" ? "MFA required" : connectionLabel(currentConnectionState)}
                </h3>
              </div>

              {localMessage ? (
                <p className="mt-2 text-xs font-semibold text-blue-700">
                  {localMessage}
                </p>
              ) : null}
            </div>

            {currentConnectionState === "rechecking" && (
              <p className="text-sm text-amber-700">Praktika is still running. Authentication is being rechecked automatically.</p>
            )}

            {["disconnected", "idle"].includes(currentConnectionState) && currentStatus !== "waiting_for_mfa" && !shouldShowCredentialForm ? (
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

          {shouldShowCredentialForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div>
                <label className="text-xs font-bold text-amber-950">
                  Username
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
                  Password
                </label>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  placeholder="Password"
                  className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </div>

              <button
                type="button"
                onClick={submitCredentials}
                disabled={credentialsSubmitting}
                className="w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {credentialsSubmitting ? "Connecting..." : "Connect"}
              </button>
            </div>
          ) : null}

          {shouldShowMfaBox ? (
            <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <label className="text-xs font-bold text-orange-950">
                MFA code
              </label>

              <div className="mt-1 flex gap-2">
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-slate-950"
                />

                <button
                  type="button"
                  onClick={submitMfaCode}
                  disabled={mfaSubmitting}
                  className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
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
            Pull Praktika letter-icon appointments. Maximum range: 7 days.
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
                min={queueFromDate || undefined}
                max={maxQueueToDate || undefined}
                onChange={(event) => updateQueueToDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={syncQueueWithDateLimit}
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