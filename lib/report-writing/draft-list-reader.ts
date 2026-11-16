import type { SupabaseClient } from '@supabase/supabase-js';
import { draftListSelect } from './draft-contract';

const pageSize = 500;
// Exact ECMAScript trim whitespace, rather than PostgreSQL's locale-dependent \s.
const nonBlank = '[^\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
// Preserve History's (edited_text || ai_generated_text || '').trim() precedence.
export const finalTextFilter = `edited_text.match."${nonBlank}",and(or(edited_text.is.null,edited_text.eq.""),ai_generated_text.match."${nonBlank}")`;

export async function readDraftList(db: SupabaseClient, providerId: string | null) {
  type Row = Record<string, unknown> & { id: string; updated_at: string | null; workflow_status?: string | null };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from('report_drafts').select(draftListSelect).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id').range(offset, offset + pageSize - 1);
    if (providerId && providerId !== 'all') query = query.eq('provider_id', providerId);
    const { data, error } = await query.returns<Row[]>();
    if (error || !data) throw new Error('Draft list unavailable');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

// Two disjoint ID/revision-only sets. No letter text crosses the database boundary.
// A failed page or a concurrently changed revision yields unknown, never an
// invented availability value. This is presentation only, not workflow evidence.
export async function readDocumentAvailability(db: SupabaseClient, providerId: string | null, ids?: string[]) {
  const signal = AbortSignal.timeout(5000);
  const result = new Map<string, { revision: string | null; available: boolean }>();
  try {
    for (const available of [true, false]) {
      for (let offset = 0; ; offset += pageSize) {
        // Complement with explicit NULL handling; SQL NOT alone is insufficient.
        const filter = available ? finalTextFilter :
          `and(edited_text.not.is.null,edited_text.neq."",edited_text.not.match."${nonBlank}"),and(or(edited_text.is.null,edited_text.eq.""),or(ai_generated_text.is.null,ai_generated_text.not.match."${nonBlank}"))`;
        let query = db.from('report_drafts').select('id,updated_at').is('deleted_at', null)
          .or(filter).order('id').range(offset, offset + pageSize - 1).abortSignal(signal);
        if (providerId && providerId !== 'all') query = query.eq('provider_id', providerId);
        // A History page checks only its own letters, never every letter's text.
        if (ids) query = query.in('id', ids);
        const { data, error } = await query;
        if (error || !data) throw new Error();
        for (const row of data) {
          if (result.has(row.id)) throw new Error(); // changed between sets
          result.set(row.id, { revision: row.updated_at, available });
        }
        if (data.length < pageSize) break;
      }
    }
    return result;
  } catch { return new Map<string, { revision: string | null; available: boolean }>(); }
}

// History pages: most recent first, filtered on the server. Order and cursor match
// readDraftList (created_at desc, id asc), so pages never overlap or skip rows.
export type DraftPageQuery = {
  providerId: string | null; limit: number; cursor: { createdAt: string; id: string } | null;
  q: string; reportType: string | null; from: string | null; to: string | null; issues?: boolean;
};
// Column-only superset of History's workflow-issue rule (getWorkflowIssues). The page
// applies the exact rule; running/failed workflows are included because enrichment can
// add an error that the stored columns do not show yet.
export const workflowIssueCandidates = [
  'workflow_praktika_upload_status.eq.error', 'workflow_icon_update_status.eq.error',
  'workflow_periodontal_chart_status.eq.error', 'workflow_mediref_status.in.(error,failed)',
  'workflow_error.not.is.null', 'workflow_status.in.(running,failed)',
  'and(praktika_letter_icon_updated_at.is.null,uploaded_to_praktika_at.not.is.null)',
  'and(praktika_letter_icon_updated_at.is.null,uploaded_to_praktika.is.true)',
  'and(report_type.eq.SPT_report,periodontal_chart_attached_at.is.null,uploaded_to_praktika_at.not.is.null)',
  'and(report_type.eq.SPT_report,periodontal_chart_attached_at.is.null,uploaded_to_praktika.is.true)',
].join(',');
// Dates of birth are stored as YYYY-MM-DD; staff may type D/M/YYYY or DD/MM/YYYY.
export function dobSearchValue(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const parts = iso ? { year: iso[1], month: iso[2], day: iso[3] } : local ? { year: local[3], month: local[2], day: local[1] } : null;
  if (!parts) return null;
  const text = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString();
}
// Characters that would change the meaning of a PostgREST filter string are removed.
export function cleanSearch(value: string | null) {
  return (value || '').replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
export function parseDraftPageQuery(params: URLSearchParams): DraftPageQuery | null {
  if (!params.has('limit')) return null;
  const limit = Math.min(200, Math.max(1, Number.parseInt(params.get('limit') || '', 10) || 100));
  const providerId = params.get('providerId');
  const [createdAt, id] = (params.get('cursor') || '').split('|');
  const cursor = createdAt && id && uuid.test(id) && Number.isFinite(Date.parse(createdAt)) ? { createdAt, id } : null;
  const reportType = params.get('reportType');
  const from = params.get('from'); const to = params.get('to');
  return {
    providerId: providerId && (providerId === 'all' || uuid.test(providerId)) ? providerId : null,
    limit, cursor, q: cleanSearch(params.get('q')),
    reportType: reportType && reportType !== 'all' ? reportType.slice(0, 100) : null,
    from: from && day.test(from) ? from : null, to: to && day.test(to) ? to : null,
    issues: params.get('status') === 'issues',
  };
}
export async function readDraftPage(db: SupabaseClient, page: DraftPageQuery) {
  type Row = Record<string, unknown> & { id: string; created_at: string; updated_at: string | null; workflow_status?: string | null };
  let query = db.from('report_drafts').select(draftListSelect).is('deleted_at', null);
  if (page.providerId && page.providerId !== 'all') query = query.eq('provider_id', page.providerId);
  if (page.reportType) query = query.eq('report_type', page.reportType);
  if (page.from) query = query.gte('created_at', `${page.from}T00:00:00.000Z`);
  if (page.to) query = query.lt('created_at', nextDay(page.to));
  if (page.q) {
    const terms = ['patient_name', 'referrer_name', 'emailed_to_referrer_email', 'workflow_error', 'workflow_last_message']
      .map(column => `${column}.ilike.*${page.q}*`);
    const dob = dobSearchValue(page.q);
    if (dob) terms.push(`patient_dob.eq.${dob}`);
    query = query.or(terms.join(','));
  }
  if (page.issues) query = query.or(workflowIssueCandidates);
  if (page.cursor) query = query.or(`created_at.lt.${page.cursor.createdAt},and(created_at.eq.${page.cursor.createdAt},id.gt.${page.cursor.id})`);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id')
    .range(0, page.limit).returns<Row[]>();
  if (error || !data) throw new Error('Draft list unavailable');
  const rows = data.slice(0, page.limit);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: data.length > page.limit && last ? `${last.created_at}|${last.id}` : null };
}
// Exact all-letter counts that need no workflow enrichment. Unknown (null) on failure.
export async function readDraftCounts(db: SupabaseClient) {
  const value = (result: { count: number | null; error: unknown }) =>
    result.error || typeof result.count !== 'number' ? null : result.count;
  const base = () => db.from('report_drafts').select('id', { count: 'exact', head: true }).is('deleted_at', null);
  const [active, awaiting] = await Promise.all([
    base().in('status', ['draft', 'edited_by_typist']).is('completed_at', null).is('emailed_to_referrer_at', null)
      .is('uploaded_to_praktika_at', null).or('uploaded_to_praktika.is.null,uploaded_to_praktika.eq.false'),
    base().eq('status', 'awaiting_provider_approval'),
  ]);
  return { activeQueueItems: value(active), awaiting: value(awaiting) };
}
