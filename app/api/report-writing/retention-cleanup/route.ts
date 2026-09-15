import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { projectWorkflowRecovery } from '@/lib/report-writing/workflow-recovery';
import { retentionAuthorized, retentionPlan, retentionSettings, type RetentionDraft } from '@/lib/report-writing/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function cleanup(req: Request) {
  if (!retentionAuthorized(req, process.env)) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  const settings = retentionSettings(process.env);
  if (!settings) return NextResponse.json({ success: false, error: 'Retention configuration is invalid.' }, { status: 503 });
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await db.from('report_drafts').select('*').is('deleted_at', null).order('id').limit(1000);
    if (error || !data) throw new Error('Retention lookup unavailable');
    const projected = await projectWorkflowRecovery(db, data as RetentionDraft[]);
    const result = { checked: data.length, sourceDeleted: 0, aiDeleted: 0, finalDeleted: 0, completedAtBackfilled: 0, skipped: 0, failures: 0, auditFailures: 0 };
    for (const draft of projected) {
      if (!retentionPlan(draft, settings)) { result.skipped++; continue; }
      try {
        // Re-read evidence immediately before writing. Never use a stale list projection.
        const { data: fresh, error: freshError } = await db.from('report_drafts').select('*').eq('id', draft.id).is('deleted_at', null).maybeSingle();
        if (freshError || !fresh) { result.skipped++; continue; }
        const [resolved] = await projectWorkflowRecovery(db, [fresh as RetentionDraft]);
        const plan = retentionPlan(resolved, settings);
        if (!plan) { result.skipped++; continue; }
        let query = db.from('report_drafts').update(plan.update).eq('id', fresh.id).is('deleted_at', null);
        // Retry/edit/projection writes advance updated_at; a concurrent change cancels cleanup.
        query = fresh.updated_at === null ? query.is('updated_at', null) : query.eq('updated_at', fresh.updated_at);
        for (const field of ['status', 'workflow_status', 'workflow_praktika_upload_status', 'workflow_mediref_status', 'workflow_icon_update_status', 'workflow_periodontal_chart_status']) {
          query = fresh[field] === null ? query.is(field, null) : query.eq(field, fresh[field]);
        }
        const { data: changed, error: writeError } = await query.select('id').maybeSingle();
        if (writeError) { result.failures++; continue; }
        if (!changed) { result.skipped++; continue; }
        if (plan.update.completed_at) result.completedAtBackfilled++;
        if (plan.deletedFields.includes('source_text')) result.sourceDeleted++;
        if (plan.deletedFields.includes('ai_generated_text')) result.aiDeleted++;
        if (plan.deletedFields.includes('edited_text')) result.finalDeleted++;
        if (plan.deletedFields.length) {
          const { error: auditError } = await db.from('report_writing_audit_events').insert({
            entity_type: 'report_draft', entity_id: fresh.id,
            actor_full_name: 'System retention cleanup', actor_initials: 'SYS',
            action: 'Retention cleanup deleted sensitive text',
            details: { deletedFields: plan.deletedFields, ...settings, authoritativeCompletedAt: plan.completedAt },
          });
          if (auditError) result.auditFailures++;
        }
      } catch { result.failures++; }
    }
    return NextResponse.json({ success: result.failures === 0 && result.auditFailures === 0, ...result, deleteFinalText: settings.deleteFinalText });
  } catch {
    return NextResponse.json({ success: false, error: 'Retention cleanup is temporarily unavailable.' }, { status: 503 });
  }
}

// Vercel Cron invokes GET. Both entry points require explicit bearer authorization.
export async function GET(req: Request) { return cleanup(req); }
export async function POST(req: Request) { return cleanup(req); }
