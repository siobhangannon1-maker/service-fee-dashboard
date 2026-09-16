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
export async function readDocumentAvailability(db: SupabaseClient, providerId: string | null) {
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
