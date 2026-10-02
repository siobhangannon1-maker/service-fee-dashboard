// Negative evidence only. No method here authorizes an external write or reuses
// a positive proof. Each owned browser context gets its own short-lived instance.
export const WRITE_AUTH_COOLDOWN_MS = 60_000;
type Event = 'cooldown_started' | 'cooldown_revalidation' | 'cooldown_cleared'
  | 'claims_suppressed' | 'invalidated' | 'probe' | 'positive_proof' | 'write_completed';
type Fields = Record<string, string | number | boolean>;
export class WriteAuthCooldown {
  private until = 0;
  private blockedAt = 0;
  private proofAt: number | undefined;
  private invalid = false;
  private revalidation?: Promise<boolean>;
  private suppressed = 0;
  constructor(private readonly emit: (event: Event, fields: Fields) => void,
    private readonly now: () => number = Date.now) {}

  isBlocked() { return this.invalid || this.until !== 0; }
  invalidate() {
    this.invalid = true;
    this.proofAt = undefined;
    this.emit('invalidated', {});
  }
  block() {
    if (this.invalid) return;
    if (!this.until) this.blockedAt = this.now();
    this.until = this.now() + WRITE_AUTH_COOLDOWN_MS;
    this.proofAt = undefined;
    this.emit('cooldown_started', { cooldownUntil: this.until, durationMs: WRITE_AUTH_COOLDOWN_MS });
  }
  probe(attempt: number, durationMs: number, category: 'verified' | 'refresh_transition' | 'challenge' | 'unverified', httpStatus?: number) {
    this.emit('probe', { attempt, durationMs, category, ...(httpStatus === undefined ? {} : { httpStatus }) });
  }
  verified() {
    if (this.invalid) return;
    const now = this.now();
    this.emit('positive_proof', { proofAt: now, ...(this.proofAt === undefined ? {} : { previousProofAgeMs: now - this.proofAt }) });
    this.proofAt = now;
    if (this.until) this.emit('cooldown_cleared', { blockedMs: now - this.blockedAt, suppressedDiscoveryCycles: this.suppressed });
    this.until = 0;
    this.suppressed = 0;
  }
  writeCompleted(job: { id: string; job_type: string; created_at?: string }) {
    if (this.invalid || this.proofAt === undefined) return;
    const created = Date.parse(job.created_at || '');
    this.emit('write_completed', {
      proofAt: this.proofAt, proofAgeMs: this.now() - this.proofAt, invalidatingTransition: false,
      ...(/^[a-f0-9-]{36}$/i.test(job.id) ? { jobId: job.id } : {}),
      ...(/^[a-z_]{1,80}$/.test(job.job_type) ? { jobType: job.job_type } : {}),
      ...(Number.isFinite(created) ? { queueToCompletionMs: this.now() - created } : {}),
    });
  }
  async canClaim(revalidate: () => Promise<void>): Promise<boolean> {
    if (this.invalid) return false;
    if (!this.until) return true;
    if (this.now() < this.until) {
      this.suppressed++;
      // Summarize on recovery; avoid one log for every idle polling cycle.
      if (this.suppressed === 1) this.emit('claims_suppressed', { cooldownUntil: this.until });
      return false;
    }
    if (!this.revalidation) {
      this.emit('cooldown_revalidation', { blockedMs: this.now() - this.blockedAt });
      this.revalidation = (async () => {
        try {
          await revalidate();
          return !this.isBlocked();
        } finally { this.revalidation = undefined; }
      })();
    }
    return this.revalidation;
  }
}
