import { PraktikaOwnershipLost, PraktikaOwnershipUnavailable, PRAKTIKA_HELPER_LEASE_MS } from './helper-lease';

// Only a successful heartbeat extends this conservative local deadline. A check
// proves ownership at that instant but does not renew the database lease.
export function createPraktikaOwnershipRecovery(options: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  stopping?: () => boolean;
} = {}) {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let deadline = now() + PRAKTIKA_HELPER_LEASE_MS;
  let expired = false;
  return {
    async run<T>(operation: () => Promise<T>, heartbeat = false): Promise<T> {
      let attempt = 0;
      for (;;) {
        if (expired || options.stopping?.() || now() >= deadline) {
          expired = true;
          throw new PraktikaOwnershipLost();
        }
        const started = now();
        try {
          const result = await operation();
          if (expired || options.stopping?.() || now() >= deadline) throw new PraktikaOwnershipLost();
          if (heartbeat) deadline = Math.max(deadline, started + PRAKTIKA_HELPER_LEASE_MS);
          return result;
        } catch (error) {
          if (!(error instanceof PraktikaOwnershipUnavailable)) throw error;
          await sleep(Math.min(1_000 * 2 ** Math.min(attempt++, 3), Math.max(0, deadline - now())));
        }
      }
    },
  };
}

// Fixed runtime error identities only; configuration and challenge errors are not
// inferred to be transient from arbitrary message text.
export function isPraktikaTransientInfrastructureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === 'TimeoutError' || value.name === 'AbortError' ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(value.code));
}
