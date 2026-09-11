// Only operation identity is compared; request IDs vary between preparations.
export function sameIconHelperTarget(original: unknown, proposed: unknown): boolean {
  const target = (request: unknown) => {
    if (!request || typeof request !== 'object') return null;
    const r = request as Record<string, unknown>;
    if (r.method !== 'POST' || r.path !== '/php/forms/db_commitFormData.php' || r.contentType !== 'json'
      || !Array.isArray(r.body) || r.body.length !== 1) return null;
    const row = r.body[0];
    if (!row || typeof row !== 'object') return null;
    const id = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v))
      && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? String(Number(v)) : null;
    const appointment = id(row.appointment_id), practice = id(row.practice_id);
    return appointment && practice ? `${practice}:${appointment}` : null;
  };
  const a = target(original), b = target(proposed);
  return a !== null && a === b;
}
