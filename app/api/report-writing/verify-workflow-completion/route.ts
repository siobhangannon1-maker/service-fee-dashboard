import { NextResponse } from 'next/server';
import { ApiAuthorizationError, requireActiveApiUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(req: Request, confirm: boolean) {
  let actorId: string;
  try { actorId = (await requireActiveApiUser(['admin','super_admin','practice_manager','typist'])).user.id; }
  catch (error) { return NextResponse.json({ success: false, error: 'An active authorized Typist account is required.' },
    { status: error instanceof ApiAuthorizationError ? error.status : 403 }); }
  try {
    const input = confirm ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(input.draftId || '') || !['praktika','mediref'].includes(input.integration)
      || (confirm && (!uuid.test(input.priorJobId || '') || input.verifiedSuccess !== true)))
      return NextResponse.json({ success: false, error: 'Explicit verification of the external operation is required.' }, { status: 400 });
    // Same RPC validates advisory eligibility and confirmation, under the draft lock.
    // Preview performs no updates; actor/provider authorization is revalidated in SQL.
    const { data, error } = await supabaseAdmin.rpc('verify_workflow_completion', {
      p_draft_id: input.draftId, p_integration: input.integration, p_prior_job_id: confirm ? input.priorJobId : null,
      p_actor_user_id: actorId, p_verified_success: confirm,
    }).abortSignal(AbortSignal.timeout(5000));
    if (error) throw new Error();
    if (!data?.ok) return NextResponse.json({ success: false, eligible: false,
      error: 'This operation cannot currently be marked completed. Refresh to check the workflow.' },
      { status: data?.code === 'not_authorized' ? 403 : confirm ? 409 : 200 });
    return NextResponse.json({ ...data, success: true });
  } catch { return NextResponse.json({ success: false, error: 'Verification acknowledgement is unavailable. Refresh before confirming again; any saved verification will be retained.' }, { status: 503 }); }
}
export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
