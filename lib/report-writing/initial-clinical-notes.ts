export type ClinicalNotesLoadStatus = "idle" | "loading" | "ready" | "error";

export function canGenerateFromClinicalNotes(options: {
  loading: boolean; detailLoading: boolean; queueSelected: boolean;
  notesStatus: ClinicalNotesLoadStatus; text: string;
}) {
  return !options.loading && !options.detailLoading && Boolean(options.text.trim()) &&
    (!options.queueSelected || options.notesStatus === "ready");
}

// Selection-time loading only. Neither appointment metadata nor the browser's
// older queue snapshot is a generation fallback. Later hydration does not edit the field.
export async function loadInitialClinicalNotes(options: {
  providerId: string; queueId: string; isCurrent: () => boolean;
  readLive?: () => Promise<string>; request?: typeof fetch;
}): Promise<{ text: string; fromCache: boolean } | null> {
  const request = options.request || fetch;
  const readCache = async () => {
    const params = new URLSearchParams({ providerId: options.providerId, queueId: options.queueId });
    const response = await request(`/api/report-writing/queue-clinical-notes?${params}`, {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const value: unknown = await response.json();
    if (!options.isCurrent()) return null;
    if (!response.ok || !value || typeof value !== "object") throw new Error();
    const data = value as Record<string, unknown>;
    if (data.success !== true || data.providerId !== options.providerId || data.queueId !== options.queueId ||
        typeof data.clinicalNotes !== "string") throw new Error();
    return data.clinicalNotes.trim();
  };
  try {
    const cached = await readCache();
    if (cached === null) return null;
    if (cached) return { text: cached, fromCache: true };
    let live = "";
    if (options.readLive && options.isCurrent()) {
      try { live = (await options.readLive()).trim(); } catch { /* Recheck cache below if hydration finished meanwhile. */ }
    }
    if (!options.isCurrent()) return null;
    if (live) return { text: live, fromCache: false };
    const hydrated = await readCache();
    if (hydrated === null) return null;
    if (hydrated) return { text: hydrated, fromCache: true };
    throw new Error();
  } catch {
    if (!options.isCurrent()) return null;
    throw new Error("Clinical notes could not be loaded. Retry before generating a letter.");
  }
}
