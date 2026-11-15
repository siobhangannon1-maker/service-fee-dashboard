// Coalesce overlapping read-only list requests in this server instance only.
// No result is cached after settlement, and every caller still authenticates.
export function createDraftListInflight() {
  const pending = new Map<string, Promise<unknown>>();
  return function read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const task = Promise.resolve().then(load).finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
    pending.set(key, task);
    return task;
  };
}
