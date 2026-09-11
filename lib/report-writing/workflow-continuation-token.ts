import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
export function continuationToken(intentId: string, lock: string, secret: string) {
  return createHmac('sha256', secret).update(`praktika-continuation:v1\0${intentId}\0${lock}`).digest('hex');
}
export function validContinuationToken(token: string, intentId: string, lock: string, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || !secret) return false;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(continuationToken(intentId, lock, secret), 'hex'));
}
export function continuationChildId(intentId: string, stage: string) {
  const hex = createHash('sha256').update(`praktika-continuation-child:v1\0${intentId}\0${stage}`).digest('hex').slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function workflowAppOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

// Must match the service-only reservation RPC; uses the existing helper PK.
export function continuationIntentId(draftId: string) {
  const hex = createHash('md5').update('praktika-complete-workflow:v1:' + draftId.toLowerCase()).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalJson(entry)).join(',') + '}';
  return JSON.stringify(value);
}
export function workflowAuthorization(draftId: string, actorId: string, options: Record<string, unknown>, secret: string) {
  return createHmac('sha256', secret).update('praktika-workflow-authorization:v1\0')
    .update(canonicalJson({ draftId: draftId.toLowerCase(), actorId: actorId.toLowerCase(), options })).digest('hex');
}
export function validWorkflowAuthorization(draftId: string, actorId: string, options: Record<string, unknown>, secret: string) {
  const { authorization, ...payload } = options;
  if (typeof authorization !== 'string' || !/^[a-f0-9]{64}$/.test(authorization) || !secret) return false;
  return timingSafeEqual(Buffer.from(authorization, 'hex'), Buffer.from(workflowAuthorization(draftId, actorId, payload, secret), 'hex'));
}

export function workflowConfigurationIssue(): 'configuration_unavailable' | null {
  return !workflowAppOrigin() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? 'configuration_unavailable' : null;
}
