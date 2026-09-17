export const activeWorkflowBatchSize = 50;
export type ActiveWorkflowStatus = { id: string; workflow_status?: string | null; updated_at: string | null };

// Change detection only: never applies status responses to the editor or decides
// completion. The existing full-list projection remains authoritative for UI.
export function startActiveWorkflowPolling(options: {
  drafts: ActiveWorkflowStatus[];
  providerId: string;
  fetch: typeof fetch;
  refresh: (signal: AbortSignal) => Promise<void>;
}) {
  const active = options.drafts.filter(d => d.workflow_status === 'running');
  if (!active.length) return () => {};
  const known = new Map(active.map(d => [d.id, JSON.stringify([d.workflow_status, d.updated_at])]));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let offset = 0;
  async function poll() {
    const batch = active.slice(offset, offset + activeWorkflowBatchSize);
    offset = offset + activeWorkflowBatchSize >= active.length ? 0 : offset + activeWorkflowBatchSize;
    try {
      const params = new URLSearchParams({ providerId: options.providerId, ids: batch.map(d => d.id).join(',') });
      const response = await options.fetch(`/api/report-writing/active-workflow-status?${params}`, {
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || data.success !== true || !Array.isArray(data.drafts) || data.drafts.length !== batch.length) throw new Error();
      const expected = new Set(batch.map(d => d.id));
      const next = new Map<string, string>();
      for (const row of data.drafts) {
        if (!row || !expected.has(row.id) || next.has(row.id) ||
          !(typeof row.workflow_status === 'string' || row.workflow_status === null) ||
          !(typeof row.updated_at === 'string' || row.updated_at === null)) throw new Error();
        next.set(row.id, JSON.stringify([row.workflow_status, row.updated_at]));
      }
      if ([...next].some(([id, marker]) => known.get(id) !== marker)) {
        await options.refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        if (controller.signal.aborted) return;
        for (const [id, marker] of next) known.set(id, marker);
      }
    } catch { /* Retain the visible list. No execution or completion inference. */ }
    if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
  }
  timer = setTimeout(poll, 5000);
  return () => { controller.abort(); clearTimeout(timer); };
}
