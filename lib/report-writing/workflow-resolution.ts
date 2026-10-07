import {manualVerification} from './manual-verification';
import { resolveWorkflow, type WorkflowDraft, type WorkflowEvidence, type BranchState } from './resolved-workflow';

export const resolutionContract = 'workflow-resolution-v1';
export const resolutionActions = ['workflow_resolution_verification', 'workflow_resolution_resume', 'workflow_resolution_completed', 'workflow_resolution_execution', 'workflow_resolution_settled','workflow_resolution_branch_fence'] as const;
export const branches = ['praktika', 'icon', 'mediref', 'periodontal'] as const;
export type ResolutionBranch = typeof branches[number];
export type VerificationOutcome = 'completed' | 'incomplete';
export type ResolutionChoices = Partial<Record<ResolutionBranch, VerificationOutcome>>;
export type EvidenceState = 'automated_completed' | 'manually_verified_completed' | 'manually_verified_incomplete' | 'unknown' | 'active' | 'failed' | 'execution_uncertain' | 'skipped';
export type ResolutionEvent = { id: string; action: string; entity_id: string; details: Record<string, unknown> };
export type ResolutionDraft = WorkflowDraft & { provider_id?: string; deleted_at?: string | null; edited_text?: string | null; ai_generated_text?: string | null; source_text?: string | null; emailed_to_referrer_resend_id?: string | null };
export type ResolutionSnapshot = { draft: ResolutionDraft; evidence: WorkflowEvidence; events: ResolutionEvent[]; fingerprint: string; letterFingerprint: string; executionSafe: boolean; reason?: string; };
export type ResolutionRow = { branch: ResolutionBranch; label: string; state: EvidenceState; automated: BranchState; required: boolean; verifiable: boolean; delivery: 'sent' | 'not_sent' | 'unknown' | null; actorUserId?: string; verifiedAt?: string; };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const labels: Record<ResolutionBranch, string> = { praktika: 'Praktika upload', icon: 'Praktika letter icons', mediref: 'MediRef delivery', periodontal: 'Periodontal chart attachment' };
const terminal = (s: BranchState) => s === 'completed' || s === 'skipped';
export function validResolutionEvents(s: ResolutionSnapshot) {
  return s.events.filter(e => e.entity_id === s.draft.id && e.details.contract === resolutionContract && e.details.version === 1 && e.details.draftId === s.draft.id && e.details.letterFingerprint === s.letterFingerprint);
}
export function resolutionRows(s: ResolutionSnapshot): ResolutionRow[] {
  const resolved = resolveWorkflow(s.draft, {...s.evidence,resolution:undefined});
  const events = validResolutionEvents(s);
  return branches.map(branch => {
    const automated = resolved.branches[branch];
    const verification = events.filter(e => e.action === 'workflow_resolution_verification' && e.details.branch === branch).at(-1);
    const legacy=(branch==='praktika'||branch==='mediref') && s.evidence.parent ? manualVerification(s.evidence.parent.response,branch,s.draft.id!,s.evidence.parent.id) : null;
    const manual = verification?.details || (legacy ? {...legacy,outcome:'completed'} : undefined);
    const med = branch === 'mediref' ? [...s.evidence.mediref].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at))).at(-1) : undefined;
    const result = object(med?.result);
    const delivery = !med ? null : result.sent === true ? 'sent' : result.sent === false ? 'not_sent' : 'unknown';
    const state: EvidenceState = !s.executionSafe ? (automated === 'active' ? 'active' : 'execution_uncertain')
      : automated === 'skipped' ? 'skipped' : manual?.outcome === 'completed' ? 'manually_verified_completed' : automated === 'completed' ? 'automated_completed' : manual?.outcome === 'incomplete' ? 'manually_verified_incomplete' : automated;
    return { branch, label: branch==='mediref' && result.prepared===true ? 'MediRef preparation' : labels[branch], state, automated, required: automated !== 'skipped',
      verifiable: s.executionSafe && state!=='manually_verified_completed' && !terminal(automated) && resolved.status !== 'completed', delivery,
      ...(manual ? { actorUserId: String(manual.actorUserId), verifiedAt: String(manual.verifiedAt) } : {}) };
  });
}
export function deriveResolution(s: ResolutionSnapshot, choices: ResolutionChoices = {}) {
  const rows = resolutionRows(s);
  const resolved = resolveWorkflow(s.draft, s.evidence);
  const parent = s.evidence.parent;
  const requirementsKnown=Boolean(parent || s.draft.workflow_periodontal_chart_status || s.draft.periodontal_chart_attachment_name || s.draft.periodontal_chart_attachment_error);
  const eligible = requirementsKnown && s.executionSafe && !resolved.lookupUnavailable && s.draft.deleted_at == null && ['approved','uploaded_to_praktika'].includes(s.draft.status || '') && resolved.status === 'needs_attention';
  const outcomes: ResolutionChoices = {};
  for (const row of rows) {
    if (!row.verifiable && choices[row.branch]) return { eligible: false, rows, outcomes, action: null, plan: [], reason: 'A confirmed or blocked step cannot be reclassified.' };
    if (row.verifiable) outcomes[row.branch] = choices[row.branch] || (row.state === 'manually_verified_completed' ? 'completed' : row.state === 'manually_verified_incomplete' ? 'incomplete' : undefined);
  }
  const unclassified = rows.some(r => r.verifiable && !outcomes[r.branch]);
  const plan = rows.filter(r => r.required && outcomes[r.branch] === 'incomplete').map(r => r.branch);
  let reason = !requirementsKnown?'Historical requirements could not be established. Further review is required.':s.reason || (eligible ? '' : 'Workflow execution must be safely reconciled before verification.');
  let resumable = eligible && !unclassified && plan.length > 0;
  const options = object(parent?.request?.options);
  // A missing helper can be reserved only through the normal signed continuation.
  // Retained attempts are not reset or replaced by this recovery class.
  if (plan.includes('praktika') && s.evidence.uploads.length > 0) { resumable = false; reason = 'Use the existing upload retry review for the retained attempt.'; }
  if (plan.includes('icon') && s.evidence.icons.length > 0) { resumable = false; reason = 'The retained icon attempt requires its existing recovery review.'; }
  if (plan.includes('mediref') && s.evidence.mediref.length > 0) { resumable = false; reason = 'The retained MediRef attempt must be reconciled without duplicate preparation.'; }
  if (plan.includes('periodontal') || (options.attachPeriodontalChart === true && plan.includes('mediref'))) { resumable = false; reason = 'Attachment dependencies require a supported artifact recovery plan.'; }
  if (plan.length && !s.draft.praktika_patient_id) { resumable = false; reason = 'The exact Praktika patient target could not be established.'; }
  // Parentless historical requirements may be classified/closed, but must not be
  // guessed into a new operational intent without a retained complete contract.
  if (!parent && plan.length && rows.find(r=>r.branch==='periodontal')?.required) { resumable = false; reason = 'Historical attachment requirements cannot safely be reconstructed.'; }
  if(parent && plan.length && options.praktikaPatientId!==s.draft.praktika_patient_id) {resumable=false;reason='The retained execution target does not match the approved letter.';}
  if (parent && (parent.status !== 'failed' || !options.actor || options.attachPeriodontalChart === undefined)) { resumable = false; reason = 'The original signed execution contract is unavailable.'; }
  return { eligible, rows, outcomes, action: !eligible || unclassified ? null : plan.length === 0 ? 'complete' : resumable ? 'resume' : 'save', plan: resumable ? plan : [], reason };
}
