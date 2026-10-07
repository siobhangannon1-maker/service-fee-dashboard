import 'server-only';
import { productionExecutionSafe } from './production-evidence';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { continuationChildId, continuationIntentId } from './workflow-continuation-token';
import type { ReadJob } from './resolved-workflow';
import type { ResolutionSnapshot, ResolutionEvent, ResolutionDraft } from './workflow-resolution';
export type ResolutionPreview = { draftId: string; actorId: string; fingerprint: string; letterFingerprint: string; expiresAt: number };
function key(secret: string) {
  if (!secret.trim()) throw new Error('Resolution signing configuration unavailable.');
  return createHash('sha256').update('workflow-resolution-preview:v1\0').update(secret).digest();
}
export function sealResolutionPreview(value: ResolutionPreview, secret: string) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
  cipher.setAAD(Buffer.from('workflow-resolution-preview:v1'));
  return Buffer.concat([nonce,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function openResolutionPreview(token: string, secret: string): ResolutionPreview {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid preview.');
  const bytes = Buffer.from(token,'base64url');
  const decipher = createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));
  decipher.setAAD(Buffer.from('workflow-resolution-preview:v1')); decipher.setAuthTag(bytes.subarray(-16));
  const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString()) as ResolutionPreview;
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < Date.now()) throw new Error('Preview expired.');
  return value;
}
export function resolutionSnapshot(value: { draft: ResolutionDraft; parent: ReadJob | null; praktika: ReadJob[]; mediref: ReadJob[]; events: ResolutionEvent[]; fingerprint: string; letterFingerprint: string; executionSafe: boolean; reason?: string }): ResolutionSnapshot {
  const parent = value.parent || undefined;
  return { ...value, executionSafe: value.executionSafe && productionExecutionSafe(String(value.draft.id),[...value.praktika,...value.mediref],value.events), evidence: { parent, hasOtherParent: value.praktika.some(j=>j.job_type==='complete_report_workflow' && j.id!==parent?.id),
    uploads:value.praktika.filter(j=>j.job_type==='upload_report_to_praktika'),icons:value.praktika.filter(j=>j.job_type==='update_praktika_letter_icons'),
    mediref:value.mediref,currentUploadId:parent ? String((parent.response as Record<string,unknown> | null)?.retryUploadId || continuationChildId(parent.id,'upload_report_to_praktika')) : undefined,
    currentIconId:parent ? continuationChildId(parent.id,'update_praktika_letter_icons') : undefined,
    reconciliations:value.events.map(e=>({...e,entity_type:'report_draft'})),livePraktikaActors:new Set<string>(),liveMediref:false } };
}
export const resolutionParentId = continuationIntentId;
