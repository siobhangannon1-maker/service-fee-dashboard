export const activeWorkflowBatchSize = 50;
export const workflowReconciliationWindowMs = 10 * 60_000;
export type ActiveWorkflowStatus = {
  id: string; status?: string; workflow_status?: string | null; updated_at: string | null;
  workflow_resolved?: { status: string; lookupUnavailable?: boolean; branches?: Record<string, string> };
  reconcileUntil?: number;
};
export function workflowPollingMode(draft: ActiveWorkflowStatus, now = Date.now()): 'running' | 'reconcile' | null {
  const resolved = draft.workflow_resolved;
  if (resolved?.status === 'completed') return null;
  if (draft.workflow_status === 'running') return !resolved || resolved.status === 'completing' ? 'running' : 'reconcile';
  if (draft.status && !['approved', 'uploaded_to_praktika'].includes(draft.status) && !(draft.reconcileUntil && draft.reconcileUntil > now)) return null;
  if ((draft.reconcileUntil || 0) > now || resolved?.status === 'completing' || resolved?.lookupUnavailable ||
    (resolved && draft.workflow_status === 'completed') ||
    (resolved?.status === 'needs_attention' && Object.values(resolved.branches || {}).includes('active'))) return 'reconcile';
  return null;
}

// Markers only detect draft changes. Enriched list refreshes also detect parent/child
// changes; completion is always decided by the existing authoritative projection.
export function startActiveWorkflowPolling(options: {
  drafts: ActiveWorkflowStatus[];
  getDrafts?: () => ActiveWorkflowStatus[];
  providerId: string;
  fetch: typeof fetch;
  refresh: (signal: AbortSignal) => Promise<void>;
}) {
  const drafts = () => options.getDrafts?.() || options.drafts;
  if (!drafts().some(d => workflowPollingMode(d))) return () => {};
  const known = new Map(options.drafts.map(d => [d.id, JSON.stringify([d.workflow_status, d.updated_at])]));
  const controller = new AbortController();
  const visibility = typeof document === 'undefined' ? undefined : document;
  const focus = typeof window === 'undefined' ? undefined : window;
  let started = Date.now(), nextRefresh = started + 15000, backoff = 15000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offset = 0, inFlight = false, refreshOnReturn = false;
  const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
  async function poll() {
    if (controller.signal.aborted || inFlight) return;
    inFlight = true;
    try {
      if (visibility?.hidden) return;
      const relevant = drafts().filter(d => workflowPollingMode(d));
      const running = relevant.filter(d => workflowPollingMode(d) === 'running');
      const reconcile = relevant.some(d => workflowPollingMode(d) === 'reconcile') && Date.now() - started < workflowReconciliationWindowMs;
      if (!running.length && !reconcile) return;
      let changed = false;
      let next = new Map<string, string>();
      if (running.length) {
        try {
          const batch = running.slice(offset, offset + activeWorkflowBatchSize);
          offset = offset + activeWorkflowBatchSize >= running.length ? 0 : offset + activeWorkflowBatchSize;
          const params = new URLSearchParams({ providerId: options.providerId, ids: batch.map(d => d.id).join(',') });
          const response = await options.fetch(`/api/report-writing/active-workflow-status?${params}`, { cache: 'no-store', signal: signal() });
          const data = await response.json();
          if (controller.signal.aborted) return;
          if (!response.ok || data.success !== true || !Array.isArray(data.drafts) || data.drafts.length !== batch.length) throw new Error();
          const expected = new Set(batch.map(d => d.id));
          for (const row of data.drafts) {
            if (!row || !expected.has(row.id) || next.has(row.id) ||
              !(typeof row.workflow_status === 'string' || row.workflow_status === null) ||
              !(typeof row.updated_at === 'string' || row.updated_at === null)) throw new Error();
            next.set(row.id, JSON.stringify([row.workflow_status, row.updated_at]));
          }
          changed = [...next].some(([id, marker]) => known.get(id) !== marker);
        } catch { next = new Map(); /* Marker failure must not block enriched reconciliation. */ }
      }
      // Legacy callers without enrichment retain marker-only behaviour.
      const enriched = relevant.some(d => d.workflow_resolved || d.reconcileUntil);
      if (changed || refreshOnReturn || (enriched && Date.now() >= nextRefresh)) {
        refreshOnReturn = false;
        nextRefresh = Date.now() + backoff;
        backoff = Math.min(backoff * 2, 60000);
        await options.refresh(signal());
        if (!controller.signal.aborted) for (const [id, marker] of next) known.set(id, marker);
      }
    } catch { /* Preserve cards and errors; never infer completion from markers. */ }
    finally {
      inFlight = false;
      if (!controller.signal.aborted && drafts().some(d => workflowPollingMode(d) === 'running' ||
        (workflowPollingMode(d) === 'reconcile' && Date.now() - started < workflowReconciliationWindowMs))) {
        timer = setTimeout(poll, 5000);
      }
    }
  }
  const returned = () => {
    if (visibility?.hidden || controller.signal.aborted || !drafts().some(d => workflowPollingMode(d))) return;
    started = Date.now(); backoff = 15000; refreshOnReturn = true;
    clearTimeout(timer);
    void poll();
  };
  visibility?.addEventListener('visibilitychange', returned);
  focus?.addEventListener('focus', returned);
  timer = setTimeout(poll, 5000);
  return () => {
    controller.abort(); clearTimeout(timer);
    visibility?.removeEventListener('visibilitychange', returned);
    focus?.removeEventListener('focus', returned);
  };
}
