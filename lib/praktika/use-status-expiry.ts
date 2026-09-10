"use client";

import { useCallback, useEffect, useRef } from "react";

export type StatusProof = {
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
  if (data.status !== "connected" || data.connected !== true ||
      data.helperAlive === false || !Number.isFinite(heartbeat) || heartbeat > now) return null;
  const authenticated = Date.parse(data.authenticatedAt || "");
  if (!Number.isFinite(authenticated) || authenticated > now) return null;
  const suppliedExpiry = Date.parse(data.authenticationExpiresAt || "");
  return Math.min(heartbeat + 90_000, Number.isFinite(suppliedExpiry) ? suppliedExpiry : authenticated + 120_000);
}

// Cached Connected expires at the earlier of lease expiry or GST proof expiry.
export function currentStatus(data: StatusProof | null, now = Date.now()): string {
  if (!data) return "loading";
  const status = data.status || "error";
  if (["idle", "not_started", "expired"].includes(status)) return "not_started";
  if (["waiting_for_credentials", "waiting_for_mfa", "error", "refresh_requested"].includes(status)) return status;
  const heartbeat = Date.parse(data.helperHeartbeatAt || "");
  const alive = Number.isFinite(heartbeat) && heartbeat <= now && now < heartbeat + 90_000;
  if (!alive || data.helperAlive === false) return "not_started";
  if (status === "checking_connection") return "checking_connection";
  if (status === "connected") {
    const expiry = connectionExpiry(data, now);
    return expiry !== null && now < expiry ? "connected" : "checking_connection";
  }
  return status;
}

// UI verification budget, independent of lease and authentication-proof freshness.
export const CHECKING_WINDOW_MS = 30_000;
export function createCheckingWindow() {
  let deadline: number | null = null;
  return (status: string, now: number) => {
    if (status !== "checking_connection") {
      deadline = null;
      return { status, deadline: null };
    }
    deadline ??= now + CHECKING_WINDOW_MS;
    return { status: now < deadline ? status : "not_started", deadline };
  };
}

export function useStatusExpiry(onExpire: (status: string) => void, boundChecking = false) {
  const callback = useRef(onExpire);
  callback.current = onExpire;
  const latest = useRef<StatusProof | null>(null);
  const checkingWindow = useRef(createCheckingWindow());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const data = latest.current;
    if (!data) return;
    const rawStatus = currentStatus(data);
    const checking = boundChecking ? checkingWindow.current(rawStatus, Date.now()) : { status: rawStatus, deadline: null };
    const status = checking.status;
    if (status !== data.status) callback.current(status);
    const deadline = status === "connected" ? connectionExpiry(data) :
      status === "checking_connection" ? Math.min(Date.parse(data.helperHeartbeatAt || "") + 90_000, checking.deadline ?? Infinity) : null;
    if (deadline !== null && Number.isFinite(deadline) && deadline > Date.now()) {
      timer.current = setTimeout(check, deadline - Date.now());
    }
    return status;
  }, [boundChecking]);
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
