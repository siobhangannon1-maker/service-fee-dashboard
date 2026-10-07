const slots = ['appointment_icon1id', 'appointment_icon2id', 'appointment_icon3id', 'appointment_icon4id'] as const;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const iconId = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)));
// db_commitFormData returns the complete committed four-slot icon state.
// A saved/success flag or a partial slot response is not this production contract.
export function isConfirmedPraktikaIcon(response: unknown, request?: unknown): boolean {
  const r = object(response);
  if (!r || 'error' in r || 'errors' in r || r.success === false || r.empty === true ||
    !slots.every(k => iconId(r[k])) || !slots.some(k => Number(r[k]) === 6597)) return false;
  if (request === undefined) return true;
  const q = object(request);
  const body = q && Array.isArray(q.body) && q.body.length === 1 ? object(q.body[0]) : null;
  return !!q && q.method === 'POST' && q.path === '/php/forms/db_commitFormData.php' && q.contentType === 'json' && !!body &&
    iconId(body.practice_id) && Number(body.practice_id) > 0 && iconId(body.appointment_id) && Number(body.appointment_id) > 0 &&
    slots.every(k => iconId(body[k]) && Number(body[k]) === Number(r[k]));
}
