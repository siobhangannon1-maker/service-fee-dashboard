// Temporary observation only. Never used to accept a response or select a retry.
export type PerioStructureReason = 'top_level_not_array' | 'returned_count_mismatch'
  | 'exam_id_missing' | 'exam_id_wrong_type' | 'requested_exam_missing' | 'duplicate_exam'
  | 'patient_id_invalid' | 'date_invalid' | 'tooth_data_missing' | 'tooth_data_null'
  | 'tooth_data_not_array' | 'tooth_data_item_invalid' | 'other_structure';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const type = (v: unknown) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const positiveId = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const dateValid = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
export function perioStructureDiagnostic(request: unknown, text: string) {
  // The caller already passed the response-size and JSON checks. Keep this helper bounded too.
  if (text.length > 8_000_000) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  const parameters = record(request) && Array.isArray(request.body) && record(request.body[0]) && Array.isArray(request.body[0].parameters)
    ? request.body[0].parameters : [];
  const expected = new Set(parameters.filter(record).map(p => String(p.perioexam_id)));
  const first = Array.isArray(data) ? data[0] : data;
  const item = record(first) ? first : {};
  const tooth = item.perioexam_toothdata;
  const wrapper = record(data) ? data : {};
  const reason = (): PerioStructureReason => {
    if (!Array.isArray(data)) return 'top_level_not_array';
    const seen = new Set<string>();
    for (const row of data) {
      if (!record(row)) return 'other_structure';
      if (!Object.hasOwn(row, 'perioexam_id')) return 'exam_id_missing';
      if (!positiveId(row.perioexam_id)) return 'exam_id_wrong_type';
      if (!expected.has(String(row.perioexam_id))) return 'requested_exam_missing';
      if (seen.has(String(row.perioexam_id))) return 'duplicate_exam';
      if (!positiveId(row.perioexam_patientid)) return 'patient_id_invalid';
      if (!dateValid(row.perioexam_date)) return 'date_invalid';
      if (!Object.hasOwn(row, 'perioexam_toothdata')) return 'tooth_data_missing';
      if (row.perioexam_toothdata === null) return 'tooth_data_null';
      if (!Array.isArray(row.perioexam_toothdata)) return 'tooth_data_not_array';
      if (!row.perioexam_toothdata.every(record)) return 'tooth_data_item_invalid';
      seen.add(String(row.perioexam_id));
    }
    if (data.length !== expected.size) return 'returned_count_mismatch';
    return 'other_structure';
  };
  return {
    reason: reason(),
    topLevelType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data === 'object' ? 'object' : typeof data === 'string' ? 'string' : 'other',
    topLevelArrayLength: Array.isArray(data) ? data.length : 0,
    firstItemType: type(first), requestedExamCount: expected.size,
    returnedItemCount: Array.isArray(data) ? data.length : record(data) ? 1 : 0,
    examIdPresent: Object.hasOwn(item, 'perioexam_id'), examIdType: type(item.perioexam_id),
    patientIdPresent: Object.hasOwn(item, 'perioexam_patientid'), patientIdType: type(item.perioexam_patientid),
    datePresent: Object.hasOwn(item, 'perioexam_date'), dateType: type(item.perioexam_date),
    dateMatchesExpectedFormat: dateValid(item.perioexam_date),
    toothDataPresent: Object.hasOwn(item, 'perioexam_toothdata'), toothDataType: type(tooth),
    toothDataIsNull: tooth === null, toothDataArrayLength: Array.isArray(tooth) ? tooth.length : 0,
    toothDataItemsAllObjects: Array.isArray(tooth) && tooth.every(record),
    hasPerioExamsArray: Array.isArray(wrapper.perio_exams),
    hasPerioExamArray: Array.isArray(wrapper.perio_exam),
    hasDataArray: Array.isArray(wrapper.data), hasResultArray: Array.isArray(wrapper.result),
  };
}
