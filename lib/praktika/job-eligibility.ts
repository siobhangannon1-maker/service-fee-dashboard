import { derivePraktikaConnection, type PraktikaConnectionRow } from './authentication';
import { allowedPraktikaRead } from './read-operations';
export function praktikaJobEligibility(row: PraktikaConnectionRow | null, jobType: string, request: unknown, now = Date.now()) {
  if (!row) return { eligible: false, readOnly: false };
  const connection = derivePraktikaConnection(row, now);
  const readOnly = allowedPraktikaRead(jobType, request);
  return { readOnly, eligible: connection.connected };
}
