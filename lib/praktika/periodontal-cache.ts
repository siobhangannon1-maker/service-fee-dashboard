import type { SupabaseClient } from '@supabase/supabase-js';
import { validatePraktikaRead } from './read-operations';
const endpoint = 'https://praktika.praktika.net.au/php/forms/db_getFormData.php';
// Existing completed helper responses are the cache; no new persistence store.
export async function cachedPeriodontalExams(db: SupabaseClient, actorId: string, patientId: number, practiceId: number): Promise<unknown[] | undefined> {
  if (!actorId || !Number.isSafeInteger(patientId) || patientId <= 0) return undefined;
  try {
    const { data: lists, error } = await db.from('praktika_helper_jobs').select('request,response')
      .eq('app_user_id', actorId).eq('status', 'completed').eq('job_type', 'periodontal_chart_patient_perio_exam_ids')
      .contains('request', { body: [{ parameters: [{ practice_id: practiceId, patient_id: patientId }] }] })
      .order('completed_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error || !lists?.length) return undefined;
    const list = validatePraktikaRead('periodontal_chart_patient_perio_exam_ids', lists[0].request, 200, endpoint, JSON.stringify(lists[0].response));
    const ids = (Array.isArray(list) ? list[0] : list) as { patient_perioexamids: Array<string | number> };
    // An old empty result is not evidence that no newer exams exist.
    if (!ids.patient_perioexamids.length) return undefined;
    const { data: jobs, error: examError } = await db.from('praktika_helper_jobs').select('request,response')
      .eq('app_user_id', actorId).eq('status', 'completed').eq('job_type', 'periodontal_chart_perio_exams')
      .contains('request', { body: [{ parameters: ids.patient_perioexamids.map(id => ({ practice_id: practiceId, perioexam_id: Number(id) })) }] })
      .order('completed_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5000));
    if (examError || !jobs?.length) return undefined;
    if (!jobs[0].request?.body?.[0]?.parameters?.every((p: { practice_id?: unknown }) => Number(p.practice_id) === practiceId)) return undefined;
    const rows = validatePraktikaRead('periodontal_chart_perio_exams', jobs[0].request, 200, endpoint, JSON.stringify(jobs[0].response)) as Array<Record<string, unknown>>;
    const expected = new Set(ids.patient_perioexamids.map(String));
    if (rows.length !== expected.size || !rows.every(row => expected.has(String(row.perioexam_id)) && Number(row.perioexam_patientid) === patientId)) return undefined;
    return rows;
  } catch { return undefined; }
}
