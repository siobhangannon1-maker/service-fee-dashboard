"use client";

import { useCallback, useEffect, useRef } from "react";

export type StatusProof = {
  operationalWithoutAuth?: boolean;
  experimentalEligible?: boolean;
  experimentalEligibilityExpiresAt?: string | null;
  status?: string;
  helperAlive?: boolean;
  storedStatus?: string;
  connected?: boolean;
  authenticatedAt?: string | null;
  authenticationExpiresAt?: string | null;
  helperHeartbeatAt?: string | null;
};

export function connectionExpiry(data: StatusProof, now = Date.now()): number | null {
  const heartbeat = Date.parse(data.helperHeartbeatAt || "");
  if (data.helperAlive !== true || !Number.isFinite(heartbeat) || heartbeat > now) return null;
  return heartbeat + 90_000;
}

export function currentStatus(data: StatusProof | null, now = Date.now()): string {
  if (!data) return "loading";
  if (["waiting_for_credentials", "waiting_for_mfa"].includes(data.status || "")) return data.status!;
  const expiry = connectionExpiry(data, now);
  if (expiry === null || now >= expiry) return "not_started";
  if (data.status === "connected" && data.connected === true &&
      (data.storedStatus === undefined || data.storedStatus === "connected")) return "connected";
  if (["refreshing", "refresh_requested"].includes(data.status || "")) return "refreshing";
  return "not_started";
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
    const deadline = ["connected", "refreshing"].includes(status) ? connectionExpiry(data) : null;
    if (deadline !== null && deadline > Date.now()) timer.current = setTimeout(check, deadline - Date.now());
    return status;
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
    return check() ?? currentStatus(data);
  }, [check]);
}
