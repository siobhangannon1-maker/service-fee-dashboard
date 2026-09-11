// Callers must explicitly opt into a supplied cache. Live retrieval never falls
// back to older data following a redirect, timeout, or other failed read.
export async function selectPeriodontalData<T>(options: {
  freshness: 'live' | 'cached' | 'prefer_cached'; cached?: T[]; live: () => Promise<T[]>;
}): Promise<T[]> {
  if (options.freshness === 'live' || (options.freshness === 'prefer_cached' && !options.cached)) return options.live();
  if (!options.cached) throw new Error('Cached periodontal data is unavailable.');
  return options.cached;
}
