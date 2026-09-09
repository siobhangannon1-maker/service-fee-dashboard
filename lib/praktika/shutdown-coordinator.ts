// This coordinator owns browser closure; no external operation is retried here.
export type ShutdownEvent = 'shutdown_started' | 'helper_signal_received' | 'drain_completed' | 'drain_deadline_exceeded' | 'browser_close_started' | 'browser_close_completed' | 'browser_close_failed' | 'restoration_requested' | 'restoration_skipped' | 'restoration_request_failed' | 'shutdown_deadline_exceeded';
export type SkipReason = 'ownership_lost' | 'no_operational_history' | 'unresolved_shutdown_work' | 'idle_deadline_expired' | 'processing_job_present' | 'session_status_ineligible' | 'rpc_rejected' | 'rpc_transport_failure' | 'not_planned' | 'browser_close_failed' | 'shutdown_deadline_exceeded';
export function createShutdownCoordinator(options: {
 close: () => Promise<void>;
 active: () => boolean;
 interrupt: () => void;
 log: (event: ShutdownEvent, metadata: { stage: string; elapsed_ms: number; reason?: SkipReason }) => void;
 exit: () => void;
}) {
 let started: number | undefined;
 let stage = 'running';
 let closePromise: Promise<boolean> | undefined;
 let drainTimer: ReturnType<typeof setTimeout> | undefined;
 let totalTimer: ReturnType<typeof setTimeout> | undefined;
 const emit = (event: ShutdownEvent, reason?: SkipReason) => options.log(event, { stage, elapsed_ms: started === undefined ? 0 : Math.round(performance.now() - started), ...(reason ? { reason } : {}) });
 const close = () => {
  if (!closePromise) {
   stage = 'browser_close'; emit('browser_close_started');
   closePromise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
     await Promise.race([Promise.resolve().then(options.close), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('close deadline')), 5_000); })]);
     emit('browser_close_completed'); return true;
    } catch { emit('browser_close_failed'); return false; }
    finally { clearTimeout(timer); }
   })();
  }
  return closePromise;
 };
 return {
  emit,
  close,
  start() {
   if (started !== undefined) return;
   started = performance.now(); stage = 'drain'; emit('helper_signal_received'); emit('shutdown_started');
   totalTimer = setTimeout(() => { emit('shutdown_deadline_exceeded'); emit('restoration_skipped', 'shutdown_deadline_exceeded'); options.exit(); }, 20_000);
   if (options.active()) {
    drainTimer = setTimeout(() => {
     if (options.active()) { emit('drain_deadline_exceeded'); options.interrupt(); }
     void close();
    }, 7_000);
   } else { emit('drain_completed'); void close(); }
  },
  drained() { clearTimeout(drainTimer); if (started !== undefined) emit('drain_completed'); },
  decision() { stage = 'restoration'; },
  finish() { clearTimeout(drainTimer); clearTimeout(totalTimer); },
 };
}
