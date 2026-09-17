import { ApiAuthorizationError, requireActiveApiUser } from '@/lib/auth';

import { approvedAttentionCohort, approvedAttentionDigest, exactAttentionEntry } from '@/lib/report-writing/historical-attention-cohort';

export const runtime = 'nodejs';

// Frozen three-record canary only. Epoch/revision are bound to these reviewed
// inspector fingerprints; the RPC recomputes the fingerprint under its locks.
const reviews = [
  ['2f442858-b565-406e-b443-9c81df082082', '2026-09-13T10:31:57.223049Z/2026-09-13T10:31:57.118000Z', '2026-09-15T04:21:53.871+00:00', '3be563b46a53fcff405a062da501433522efb81bcb0e589ae6751413684cadce', '4a411f1b-26e3-31ce-2167-3a87d6a96053', '8d3a0cf74791d025a5102d95414963e3655602cc9a18ca01bb989125192d9379'],
  ['6b1a65f9-9769-4f89-b6c5-cfc2bd09c4e5', '2026-09-13T09:06:35.189990Z/2026-09-13T09:06:35.080000Z', '2026-09-15T04:07:54.128+00:00', '290171b930f63b08876511bb35992f4602e4ed8a05069bfd7fe906a9771802ce', '077d9a81-d934-b3a5-3573-edd831c7a3d4', '606c45a1dd11e66fc794dea130e77d4872336041a4a4247e30b2a90c61e51855'],
  ['cc046477-11e6-45c1-afbc-80d3d66d4172', '2026-09-13T10:04:12.681405Z/2026-09-13T10:04:12.584000Z', '2026-09-15T04:10:38.886+00:00', '974c3836e4cc36ba872e16415751bd4dd9a3c369878887f8f4cceff47351b047', '4192c27f-e0c9-67b0-c5df-2539f757b866', '9e1c4b011af992919e7413e633cac8bed3f7390d12ddc3118405653b2066f99e'],
].map(([draftId, epoch, revision, fingerprint, uploadJobId, artifactFingerprint]) => ({
  draftId, epoch, revision, fingerprint, uploadJobId, artifactFingerprint,
  manifestDigest: 'e399e2d422af85cdacd9cfba0618f9742728183ba5a2e554116bb0ee6e44b8f5',
  branches: ['mediref', 'icon', 'bookkeeping'], policyVersion: 'historical-attention-v1',
  reason: 'historical_pdf_present_no_further_action', evidenceKind: 'confirmed_upload',
}));

export async function POST(req: Request) {
  let identity: Awaited<ReturnType<typeof requireActiveApiUser>>;
  try { identity = await requireActiveApiUser(['admin', 'super_admin']); }
  catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    return Response.json({ success: false, error: status === 401 ? 'Authentication required.' : 'An active administrator account is required.' }, { status });
  }
  // Cookie-authenticated mutation: require a same-origin JSON browser request.
  if (req.headers.get('origin') !== new URL(req.url).origin ||
      req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    return Response.json({ success: false, error: 'A same-origin JSON request is required.' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return Response.json({ success: false, error: 'Invalid reviewed disposition.' }, { status: 400 }); }
  let review: (typeof reviews)[number] | ReturnType<typeof exactAttentionEntry>;
  try {
    const legacy = body && typeof body === 'object' && !Array.isArray(body) && reviews.find(r => r.draftId === body.draftId);
    review = body && typeof body === 'object' && !Array.isArray(body) && 'cohortDigest' in body ? exactAttentionEntry(body) :
      legacy && Object.keys(body).length === Object.keys(legacy).length + 1 && typeof body.execute === 'boolean' &&
      Object.entries(legacy).every(([key, value]) => JSON.stringify(body[key]) === JSON.stringify(value)) ? legacy : null;
  } catch { return Response.json({ success: false, error: 'Frozen cohort unavailable.' }, { status: 503 }); }
  if (!review) return Response.json({ success: false, error: 'Input must match an exact approved frozen review.' }, { status: 400 });
  try {
    const { data, error } = await identity.supabase.rpc('disposition_historical_attention', {
      p_draft_id: review.draftId, p_fingerprint: review.fingerprint, p_manifest_digest: 'manifestDigest' in review ? review.manifestDigest : approvedAttentionDigest,
      p_upload_job_id: review.uploadJobId, p_artifact_fingerprint: review.artifactFingerprint,
      p_evidence_kind: review.evidenceKind, p_operator_confirmed: false, p_execute: body.execute,
    }).abortSignal(AbortSignal.timeout(5000));
    if (error) throw new Error();
    if (data?.ok !== true) return Response.json({ success: false, error: 'The database rejected this review. Stop; do not continue the canary.' }, { status: data?.code === 'forbidden' ? 403 : 409 });
    if (!(body.execute ? ['dispositioned', 'already_dispositioned'] : ['eligible', 'already_dispositioned']).includes(data.code)) throw new Error();
    return Response.json({ success: true, draftId: review.draftId, result: data.code });
  } catch {
    return Response.json({ success: false, error: 'Disposition acknowledgement is unavailable. Stop and check the exact audit event before retrying.' }, { status: 503 });
  }
}

// Explicit operator load only; never mounted on a card or polled. No service client.
export async function GET(req: Request) {
  try { await requireActiveApiUser(['admin', 'super_admin']); }
  catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    return Response.json({ success: false, error: 'An authenticated active administrator is required.' }, { status });
  }
  if (new URL(req.url).searchParams.get('cohortDigest') !== approvedAttentionDigest)
    return Response.json({ success: false, error: 'Approved cohort digest required.' }, { status: 400 });
  try {
    return Response.json({ success: true, cohortDigest: approvedAttentionDigest, cohort: approvedAttentionCohort() },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ success: false, error: 'Frozen cohort unavailable.' }, { status: 503 }); }
}
