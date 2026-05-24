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

function shouldShowNotification(status: PraktikaStatus) {
  return (
    status === "waiting_for_credentials" ||
    status === "waiting_for_mfa" ||
    status === "expired" ||
    status === "error"
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
        return;
      }

      if (
        shouldShowNotification(next.status) &&
        dismissedForStatus !== next.status
      ) {
        setOpen(true);
      }
    } catch {
      // Ignore temporary network/dev reload interruptions.
    }
  }

  useEffect(() => {
    loadStatus();

    const timer = window.setInterval(loadStatus, 5000);

    return () => window.clearInterval(timer);
  }, [dismissedForStatus]);

  if (!open) return null;

  const title =
    session.status === "waiting_for_mfa"
      ? "Praktika MFA needed"
      : "Praktika login needed";

  const message =
    session.status === "waiting_for_mfa"
      ? "Praktika is asking for an MFA code. Please enter it in the Praktika Session panel."
      : "Your Praktika connection needs attention. Please reconnect from the Praktika Session panel.";

  return (
    <div className="fixed bottom-5 right-5 z-[9999] w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-950">{title}</h2>

          <p className="mt-2 text-sm leading-5 text-slate-600">{message}</p>

          {session.praktikaUsername ? (
            <p className="mt-2 text-xs text-slate-500">
              Connected as: <strong>{session.praktikaUsername}</strong>
            </p>
          ) : null}

          {session.message ? (
            <p className="mt-2 text-xs leading-5 text-amber-800">
              {session.message}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDismissedForStatus(session.status);
          }}
          className="rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        Use the Praktika Session panel on the page.
      </p>
    </div>
  );
}