export type PraktikaReadFailureCategory =
  | 'http_307' | 'http_other' | 'transport_failure' | 'response_url_mismatch'
  | 'response_too_large' | 'invalid_json' | 'error_envelope' | 'invalid_structure'
  | 'missing_exam_id' | 'result_persistence_failure';
export class PraktikaReadFailure extends Error {
  constructor(readonly failureCategory: PraktikaReadFailureCategory) {
    super('Praktika read is temporarily unavailable.');
  }
}

// Semantic allowlist, not an HTTP-method inference. All other jobs keep the write gate.
export const PERIO_READ_FIELDS = {
  periodontal_chart_patient_perio_exam_ids: ['patient_perioexamids', 'patient_medicalhistory', 'patient_images'],
  periodontal_chart_perio_exams: ['perioexam_id', 'perioexam_patientid', 'perioexam_providerid', 'perioexam_date',
    'perioexam_notes', 'perioexam_diagnosis', 'perioexam_boneloss', 'perioexam_systemicfactors', 'perioexam_toothdata'],
} as const;
type ReadType = keyof typeof PERIO_READ_FIELDS;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const positiveId = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
export function allowedPraktikaRead(jobType: string, request: unknown): request is Record<string, unknown> {
  if (!(jobType in PERIO_READ_FIELDS) || !Object.hasOwn(PERIO_READ_FIELDS, jobType) || !record(request)) return false;
  if (request.method !== 'POST' || request.path !== '/php/forms/db_getFormData.php' || request.contentType !== 'json') return false;
  if (!Array.isArray(request.body) || request.body.length !== 1 || !record(request.body[0])) return false;
  const body = request.body[0];
  if (Object.keys(body).some(k => k !== 'parameters' && k !== 'fields')) return false;
  const fields = PERIO_READ_FIELDS[jobType as ReadType];
  const requestedFields = body.fields;
  if (!Array.isArray(requestedFields) || requestedFields.length !== fields.length || !fields.every(f => requestedFields.includes(f))) return false;
  const idKey = jobType === 'periodontal_chart_perio_exams' ? 'perioexam_id' : 'patient_id';
  return Array.isArray(body.parameters) && body.parameters.length > 0 && body.parameters.length <= 1000
    && (idKey !== 'patient_id' || body.parameters.length === 1)
    && body.parameters.every(p => record(p) && Object.keys(p).length === 2
      && positiveId(p.practice_id) && positiveId(p[idKey]));
}
export function validatePraktikaRead(jobType: string, request: unknown, status: number, url: string, text: string): unknown {
  const unavailable = (category: PraktikaReadFailureCategory = 'invalid_structure'): never => { throw new PraktikaReadFailure(category); };
  if (!allowedPraktikaRead(jobType, request)) return unavailable();
  if (status < 200 || status >= 300) return unavailable(status === 307 ? 'http_307' : 'http_other');
  if (url !== 'https://praktika.praktika.net.au/php/forms/db_getFormData.php') return unavailable('response_url_mismatch');
  if (text.length > 8_000_000) return unavailable('response_too_large');
  let data: unknown;
  try { data = JSON.parse(text); } catch { return unavailable('invalid_json'); }
  const rows = Array.isArray(data) ? data : [data];
  const errorKeys = ['error', 'errors', 'error_message', 'errorMessage', 'exception', 'login', 'mfa', 'redirect', 'success', 'authenticationRequired', 'requiresLogin', 'requiresMfa'];
  if (!rows.every(record)) return unavailable();
  if (rows.some(row => errorKeys.some(k => Object.hasOwn(row as object, k)))) return unavailable('error_envelope');
  if (jobType === 'periodontal_chart_patient_perio_exam_ids') {
    if (rows.length !== 1 || !record(rows[0]) || !Array.isArray(rows[0].patient_perioexamids)
      || !rows[0].patient_perioexamids.every(positiveId)) return unavailable();
  } else {
    const body = (request.body as Array<{ parameters: Array<{ perioexam_id: unknown }> }>)[0];
    // Live single-exam responses may be an object. Wrappers and multi-exam
    // object responses are not accepted; all existing record checks still apply.
    if (body.parameters.length === 1 && record(data) && Object.hasOwn(data, 'perioexam_id')) data = rows;
    const expected = new Set(body.parameters.map(p => String(p.perioexam_id)));
    const seen = new Set<string>();
    if (!Array.isArray(data) || !rows.every(row => {
      if (!record(row) || !positiveId(row.perioexam_id) || !expected.has(String(row.perioexam_id))
        || seen.has(String(row.perioexam_id)) || !positiveId(row.perioexam_patientid)
        || typeof row.perioexam_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(row.perioexam_date)
        || !Array.isArray(row.perioexam_toothdata) || !row.perioexam_toothdata.every(record)) return false;
      seen.add(String(row.perioexam_id)); return true;
    })) return unavailable();
    if (seen.size !== expected.size) return unavailable('missing_exam_id');
  }
  return data;
}

// Audited retrieval jobs that still require global proof. Their existing bounded
// read retries remain available; this inventory does NOT grant the stale-proof bypass.
const VERIFIED_READ_PATHS: Record<string, string> = {
  patient_match_search: '/php/json/db_gridPatientList.php',
  sync_report_referring_parties: '/php/json/db_getCustomerReferringParties.php',
  sync_report_referrers: '/php/json/db_reportingDataWarehouse.php',
  sync_appointments_bulk: '/php/json/db_reportingDataWarehouse.php',
  sync_letter_queue_appointments: '/php/json/db_reportingDataWarehouse.php',
  completed_procedures_report: '/php/json/db_reportingDataWarehouse.php',
  praktika_test_connection: '/php/json/db_reportingDataWarehouse.php',
  get_clinical_notes: '/php/forms/db_getFormData.php',
  get_clinical_notes_before_add: '/php/forms/db_getFormData.php',
  get_patient_clinical_notes: '/php/forms/db_getFormData.php',
  get_clinical_notes_before_scribe_add: '/php/forms/db_getFormData.php',
  reception_fetch_clinical_notes: '/php/forms/db_getFormData.php',
  report_writing_clinical_notes: '/php/forms/db_getFormData.php',
  report_writing_latest_referral: '/php/forms/db_getFormData.php',
  enrich_letter_queue_patient_form_latest_referral_only: '/php/forms/db_getFormData.php',
};
export function verifiedReadOperation(jobType: string, request: unknown) {
  return Object.hasOwn(VERIFIED_READ_PATHS, jobType) && record(request)
    && request.method === 'POST' && request.path === VERIFIED_READ_PATHS[jobType];
}
