"use client";

import { useCallback, useEffect, useRef } from "react";

export type StatusProof = {
  status?: string;
  helperAlive?: boolean;
  storedStatus?: string;
  connected?: boolean;
  authenticatedAt?: string | null;
  helperHeartbeatAt?: string | null;
};

export function connectionExpiry(data: StatusProof, now = Date.now()): number | null {
  const heartbeat = Date.parse(data.helperHeartbeatAt || "");
  if (data.status !== "connected" || data.connected !== true ||
      data.helperAlive === false || !Number.isFinite(heartbeat) || heartbeat > now) return null;
  return heartbeat + 90_000;
}

// Cached operational availability expires with the lease, not the GST proof.
export function currentStatus(data: StatusProof | null, now = Date.now()): string {
  if (!data) return "loading";
  const status = data.status || "error";
  if (["idle", "not_started", "expired"].includes(status)) return "not_started";
  if (["waiting_for_credentials", "waiting_for_mfa", "error", "refresh_requested"].includes(status)) return status;
  const heartbeat = Date.parse(data.helperHeartbeatAt || "");
  const alive = Number.isFinite(heartbeat) && heartbeat <= now && now < heartbeat + 90_000;
  if (!alive || data.helperAlive === false) return "not_started";
  if (status === "checking_connection") return "connected";
  if (status === "connected") {
    const expiry = connectionExpiry(data, now);
    return expiry !== null && now < expiry ? "connected" : "not_started";
  }
  return status;
}

export function useStatusExpiry(onExpire: (status: string) => void) {
  const callback = useRef(onExpire);
  callback.current = onExpire;
  const latest = useRef<StatusProof | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const data = latest.current;
    if (!data) return;
    const status = currentStatus(data);
    if (status !== data.status) callback.current(status);
    const deadline = status === "connected"
      ? Date.parse(data.helperHeartbeatAt || "") + 90_000 : null;
    if (deadline !== null && Number.isFinite(deadline) && deadline > Date.now()) {
      timer.current = setTimeout(check, deadline - Date.now());
    }
  }, []);
  useEffect(() => {
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [check]);
  return useCallback((data: StatusProof) => {
    latest.current = data;
    check();
    return currentStatus(data);
  }, [check]);
}
