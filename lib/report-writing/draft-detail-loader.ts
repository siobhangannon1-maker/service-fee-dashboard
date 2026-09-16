import type { DraftDetail } from './draft-contract';

// Component-owned, in-flight only. Settled detail is never retained as a cache.
export function createDraftDetailLoader(fetcher: typeof fetch = fetch) {
  const pending = new Map<string, Promise<DraftDetail>>();
  return (id: string, providerId: string): Promise<DraftDetail> => {
    const key = `${providerId}:${id}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const response = await fetcher(`/api/report-writing/get-draft?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json();
      const draft = data.draft;
      if (!response.ok || !data.success || !draft || draft.id !== id || draft.provider_id !== providerId ||
        !['source_text', 'edited_text', 'ai_generated_text', 'updated_at'].every(key => Object.prototype.hasOwnProperty.call(draft, key)))
        throw new Error('Letter could not be loaded. Please select it again.');
      return draft as DraftDetail;
    })();
    pending.set(key, request);
    void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
    return request;
  };
}
