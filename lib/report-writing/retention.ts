import { timingSafeEqual } from 'node:crypto';
import type { WorkflowDraft } from './resolved-workflow';

export type RetentionDraft = WorkflowDraft & {
  id: string; updated_at: string | null; deleted_at?: string | null;
  completed_at?: string | null; source_text?: string | null; ai_generated_text?: string | null; edited_text?: string | null;
  sensitive_source_deleted_at?: string | null; ai_text_deleted_at?: string | null; final_text_deleted_at?: string | null;
  retention_status?: string | null; workflowStatusStale?: boolean;
};
export type RetentionSettings = { sourceDays: number; aiDays: number; finalDays: number; deleteFinalText: boolean };
export function retentionAuthorized(req: Request, env: Record<string, string | undefined>): boolean {
  const secret = env.RETENTION_CLEANUP_SECRET;
  if (!secret?.trim()) return false;
  // Vercel sends CRON_SECRET automatically. Require deliberate retention opt-in.
  if (req.method === 'GET' && (!env.CRON_SECRET?.trim() || env.CRON_SECRET !== secret)) return false;
  const actual = Buffer.from(req.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function retentionSettings(env: Record<string, string | undefined>): RetentionSettings | null {
  const days = [env.RETENTION_SOURCE_DAYS ?? '30', env.RETENTION_AI_DAYS ?? '30', env.RETENTION_FINAL_TEXT_DAYS ?? '90'].map(Number);
  if (days.some(n => !Number.isSafeInteger(n) || n <= 0)) return null;
  return { sourceDays: days[0], aiDays: days[1], finalDays: days[2], deleteFinalText: env.RETENTION_DELETE_FINAL_TEXT === 'true' };
}
export function retentionPlan(d: RetentionDraft, settings: RetentionSettings, now = Date.now()) {
  const r = d.workflow_resolved;
  // Only durable historical provenance carries this hold; modern retention is unchanged.
  if (r?.historicalRetention && r.historicalRetention.released !== true) return null;
  if (d.deleted_at || d.workflowStatusStale || !r || r.lookupUnavailable || r.status !== 'completed' ||
    !Number.isFinite(r.completedAt) || !r.completedAt || r.completedAt > now || r.completedAt <= 0) return null;
  const completedAt = new Date(r.completedAt).toISOString();
  const stamp = new Date(now).toISOString();
  const update: Record<string, string | null> = {};
  const deletedFields: string[] = [];
  // Existing completed_at is never used to determine age or overwritten.
  if (!d.completed_at) update.completed_at = completedAt;
  for (const [field, marker, days, enabled] of [
    ['source_text','sensitive_source_deleted_at',settings.sourceDays,true],
    ['ai_generated_text','ai_text_deleted_at',settings.aiDays,true],
    ['edited_text','final_text_deleted_at',settings.finalDays,settings.deleteFinalText],
  ] as const) {
    if (enabled && d[field] && !d[marker] && now - r.completedAt >= days * 86_400_000) {
      update[field] = null; update[marker] = stamp; deletedFields.push(field);
    }
  }
  if (!Object.keys(update).length) return null;
  update.retention_status = update.final_text_deleted_at || d.final_text_deleted_at ? 'final_text_deleted'
    : update.ai_text_deleted_at || d.ai_text_deleted_at ? 'ai_and_source_deleted'
    : update.sensitive_source_deleted_at || d.sensitive_source_deleted_at ? 'source_deleted' : d.retention_status || 'completed';
  update.updated_at = stamp;
  return { update, deletedFields, completedAt };
}
