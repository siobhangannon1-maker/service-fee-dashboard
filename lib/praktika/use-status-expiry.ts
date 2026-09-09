"use client";

import { useCallback, useEffect, useRef } from "react";

type StatusProof = {
  status?: string;
  helperAlive?: boolean;
  storedStatus?: string;
  connected?: boolean;
  authenticatedAt?: string | null;
  helperHeartbeatAt?: string | null;
};

// Conservative UI deadlines matching the production 120s proof / 90s lease.
// Status responses can remove green sooner; polling never extends these deadlines.
export function connectionExpiry(data: StatusProof, now = Date.now()): number | null {
  const proof = Date.parse(data.authenticatedAt || "");
  const heartbeat = Date.parse(data.helperHeartbeatAt || "");
  if (data.status !== "connected" || data.connected !== true ||
      !Number.isFinite(proof) || !Number.isFinite(heartbeat) || proof > now || heartbeat > now) return null;
  return Math.min(proof + 120_000, heartbeat + 90_000);
}

export function useStatusExpiry(onExpire: () => void) {
  const callback = useRef(onExpire);
  callback.current = onExpire;
  const deadline = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (deadline.current === null) return;
    const remaining = deadline.current - Date.now();
    if (remaining <= 0) {
      deadline.current = null;
      callback.current();
    } else timer.current = setTimeout(check, remaining);
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
    deadline.current = connectionExpiry(data);
    const status = data.status === "connected" &&
      (deadline.current === null || deadline.current <= Date.now()) ? "refreshing" : data.status || "error";
    check();
    if (["idle", "not_started", "expired"].includes(status)) return "not_started";
    if (status === "refreshing" && (data.status === "connected" || data.helperAlive === false || data.storedStatus === "connected")) return "not_started";
    return status;
  }, [check]);
}
