// Read-only refresh: provider approvals can arrive while no workflow is active.
export function startTypistListRefresh(refresh: (signal: AbortSignal) => Promise<unknown>) {
  let busy = false;
  const controller = new AbortController();
  const run = async () => {
    if (busy || document.hidden || controller.signal.aborted) return;
    busy = true;
    try { await refresh(controller.signal); } catch { /* Keep the last authoritative list. */ }
    finally { busy = false; }
  };
  void run();
  const timer = window.setInterval(() => { void run(); }, 30000);
  const visible = () => { void run(); };
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  return () => {
    controller.abort(); window.clearInterval(timer);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
