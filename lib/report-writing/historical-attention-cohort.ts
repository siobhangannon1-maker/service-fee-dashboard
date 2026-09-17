import 'server-only';
import { createHash } from 'node:crypto';
import frozen from './historical-attention-cohort.json';

export const approvedAttentionDigest = 'caeb542145f38be0deb380c115745bde5e6ab394434933f5282288e851ade5af';
// Deployment-owned authorization scope, never supplied or replaced by the browser.
export function approvedAttentionCohort() {
  if (createHash('sha256').update(JSON.stringify(frozen)).digest('hex') !== approvedAttentionDigest ||
      frozen.records.length !== 61 || new Set(frozen.records.map(r => r.draftId)).size !== 61 ||
      frozen.records.some(r => r.evidenceKind !== 'confirmed_upload')) throw new Error('Frozen cohort unavailable');
  return frozen;
}
export function exactAttentionEntry(body: Record<string, unknown>) {
  if (body.cohortDigest !== approvedAttentionDigest) return null;
  const entry = approvedAttentionCohort().records.find(r => r.draftId === body.draftId);
  if (!entry || Object.keys(body).length !== Object.keys(entry).length + 2 || typeof body.execute !== 'boolean' ||
      Object.entries(entry).some(([k, v]) => JSON.stringify(body[k]) !== JSON.stringify(v))) return null;
  return entry;
}
