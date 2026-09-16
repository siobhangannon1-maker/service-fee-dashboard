import type { ReadJob, WorkflowDraft, WorkflowEvidence } from './resolved-workflow';
import { isConfirmedPraktikaUpload } from './praktika-upload-result';

export type HistoricalUploadAudit = {
  id: string; entity_type: string; entity_id: string; action: string;
  helperJobId: unknown; storagePath: unknown; bucket: unknown; fileName: unknown;
  contentType: unknown; patientId: unknown; actorUserId: unknown;
};
export type HistoricalEvidence = {
  uploads: ReadJob[]; icons: ReadJob[]; audits: HistoricalUploadAudit[];
  // Also search the deterministic parent ID, even if its request is malformed.
  hasParent: boolean;
  duplicateIconAudit?: boolean;
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const skip = (v: unknown) => v === 'skipped' || v === 'not_requested';
const modernKeys = ['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId'];
const modern = (v: unknown) => modernKeys.some(k => Object.hasOwn(obj(v), k));
function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x,i) => equalJson(x,b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(b)) return false;
  const x = obj(a), y = obj(b), keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y,k) && equalJson(x[k],y[k]));
}

// Pure association only: retain the actual jobs/responses; never synthesize modern
// linkage or positive results. Callers must supply ALL matching attempts/audits.
export function historicalWorkflowAssociation(d: WorkflowDraft, e: WorkflowEvidence): { upload: ReadJob; icon?: ReadJob } | null {
  const h = e.historical;
  if (!h || !d.id || !uuid.test(d.id) || e.parent || e.hasOtherParent || h.hasParent || e.uploads.length || e.icons.length ||
    d.workflow_status !== 'completed' || d.workflow_praktika_upload_status !== 'completed' ||
    !(d.workflow_icon_update_status === 'completed' || skip(d.workflow_icon_update_status)) ||
    !(d.workflow_mediref_status === 'completed' || skip(d.workflow_mediref_status)) ||
    e.mediref.length > 1 || e.mediref.some(j => j.payload?.draftId !== d.id || j.payload?.workflowContinuationId || j.payload?.retryMediref) ||
    h.uploads.length !== 1 || h.audits.length !== 1) return null;
  const upload = h.uploads[0], audit = h.audits[0], request = obj(upload.request);
  const body = obj(request.body), file = obj(body.file), fields = obj(body.fields);
  if (d.provider_approved_at && !(Date.parse(d.provider_approved_at) <= Date.parse(upload.created_at || ''))) return null;
  if (upload.job_type !== 'upload_report_to_praktika' || upload.status !== 'completed' || !isConfirmedPraktikaUpload(upload.response) ||
    modern(request) || modern(upload.response) || request.method !== 'POST' || request.path !== '/php/forms/db_updateFormData.php' ||
    request.contentType !== 'multipart_storage' || !text(file.path)) return null;
  const path = file.path.split('/');
  if (path.length !== 4 || path[0] !== 'report-uploads' || path[2] !== d.id ||
    path[1] !== (upload.app_user_id || 'practice') || (path[1] !== 'practice' && !uuid.test(path[1])) ||
    !/^\d+-[^/\\?#]+\.pdf$/i.test(path[3]) || !text(file.fileName) || !path[3].endsWith(`-${file.fileName}`) ||
    file.contentType !== 'application/pdf' || file.fieldName !== 'patient_communication[file][file]' || !text(file.bucket) ||
    fields['patient_communication[file][name]'] !== file.fileName || !text(d.praktika_patient_id) ||
    String(fields.patient_id ?? '') !== d.praktika_patient_id) return null;
  if (audit.entity_type !== 'report_draft' || audit.entity_id !== d.id || audit.action !== 'Queued report upload to Praktika' ||
    audit.helperJobId !== upload.id || audit.storagePath !== file.path || audit.bucket !== file.bucket || audit.fileName !== file.fileName ||
    audit.contentType !== file.contentType || String(audit.patientId ?? '') !== d.praktika_patient_id ||
    !text(audit.actorUserId) || !uuid.test(audit.actorUserId) || (upload.app_user_id && audit.actorUserId !== upload.app_user_id)) return null;
  // Unknown revision-bearing metadata is not a legacy contract we can interpret.
  if (['revision','reportRevision','artifactId','artifactHash','pdfHash'].some(k =>
    [request,body,file].some(v=>Object.hasOwn(v,k)))) return null;
  if (skip(d.workflow_icon_update_status)) return h.icons.length ? null : { upload };
  if (h.duplicateIconAudit || !text(d.praktika_letter_icon_appointment_id) || !text(d.praktika_letter_icon_update_response_preview)) return null;
  let preview: unknown;
  try { preview = JSON.parse(d.praktika_letter_icon_update_response_preview); } catch { return null; }
  const auditTime = Date.parse(d.praktika_letter_icon_updated_at || '');
  const matches = h.icons.filter(j => {
    const r = obj(j.response), b = j.request?.body;
    const completed = Date.parse(j.completed_at || j.updated_at || '');
    return j.job_type === 'update_praktika_letter_icons' && j.status === 'completed' && !modern(j.request) && !modern(j.response) &&
      Array.isArray(b) && b.length === 1 && String(obj(b[0]).appointment_id ?? '') === d.praktika_letter_icon_appointment_id &&
      j.app_user_id === upload.app_user_id && Object.keys(r).length > 0 && !r.error && r.success !== false && r.empty !== true &&
      equalJson(preview,j.response) && Number.isFinite(auditTime) && completed <= auditTime && auditTime - completed <= 60_000;
  });
  // An appointment's unrelated older icon changes are not this draft's workflow.
  // But modern linkage or an attempt at/after its saved audit cannot be ignored.
  if (matches.length !== 1 || h.icons.some(j => j.id !== matches[0].id &&
    (modern(j.request) || Date.parse(j.created_at || '') >= auditTime))) return null;
  return { upload, icon: matches[0] };
}
