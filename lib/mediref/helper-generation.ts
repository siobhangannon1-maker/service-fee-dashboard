// Independent of the browser's 30-second keep-alive loop (which waits for jobs).
// Four missed 30-second heartbeats expire ownership; RPC timeouts are bounded to 5s.
export const MEDIREF_HEARTBEAT_MS = 30_000;
export const MEDIREF_LEASE_MS = 120_000;
export const MEDIREF_AUTH_FRESHNESS_MS = 5 * 60_000;
export interface GenerationClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function claimMedirefGeneration(client: GenerationClient, sessionId: string) {
  const { data, error } = await client.rpc("claim_mediref_helper", { p_session_id: sessionId });
  if (error) throw new Error("MediRef helper claim unavailable.");
  return typeof data === "string" ? data : null;
}
export async function writeMedirefGeneration(client: GenerationClient, sessionId: string, instanceId: string,
  action: string, values: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc("mediref_helper_write", {
    p_session_id: sessionId, p_instance_id: instanceId, p_action: action, p_values: values,
  });
  if (error) throw new Error("MediRef helper ownership unavailable.");
  return data === true;
}

export function createMedirefLifecycle(options: {
  write(action: string, values?: Record<string, unknown>): Promise<boolean>;
  close(): Promise<void>;
  exit(): void;
  heartbeatMs?: number;
  cleanupMs?: number;
}) {
  let stopping = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let beating = false;
  let cleanup: Promise<void> | undefined;
  let exited = false;
  const exit = () => { if (!exited) { exited = true; options.exit(); } };
  const stop = () => {
    if (cleanup) return cleanup;
    stopping = true;
    clearInterval(heartbeat);
    cleanup = (async () => {
      const deadline = setTimeout(exit, options.cleanupMs ?? 20_000);
      try {
        // Invalidate proof promptly, but retain ownership until Chromium is closed.
        await options.write("stop").catch(() => false);
        await options.close();
        await options.write("release").catch(() => false);
      } catch { /* Unknown browser-close outcome: ownership expires, never release early. */ }
      finally { clearTimeout(deadline); exit(); }
    })();
    return cleanup;
  };
  return {
    get stopping() { return stopping; },
    stop,
    async write(action: string, values?: Record<string, unknown>) {
      if (stopping) throw new Error("MediRef helper is stopping.");
      try {
        if (!await options.write(action, values)) throw new Error();
      } catch {
        void stop();
        throw new Error("MediRef helper ownership unavailable.");
      }
    },
    start() {
      if (heartbeat || stopping) return;
      heartbeat = setInterval(async () => {
        if (beating || stopping) return;
        beating = true;
        try { if (!await options.write("heartbeat")) void stop(); }
        catch { void stop(); }
        finally { beating = false; }
      }, options.heartbeatMs ?? MEDIREF_HEARTBEAT_MS);
    },
  };
}
