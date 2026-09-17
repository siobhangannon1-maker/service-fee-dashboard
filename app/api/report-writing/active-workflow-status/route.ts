import { NextResponse } from 'next/server';
import { ApiAuthorizationError, requireActiveApiUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { activeWorkflowBatchSize } from '@/lib/report-writing/active-workflow-poll';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  try {
    await requireActiveApiUser(['admin', 'super_admin', 'practice_manager', 'typist']);
    const params = new URL(req.url).searchParams;
    const providerId = params.get('providerId') || '';
    const ids = (params.get('ids') || '').split(',');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(providerId) || ids.length > activeWorkflowBatchSize || ids.some(id => !uuid.test(id)) || new Set(ids).size !== ids.length)
      return NextResponse.json({ success: false, error: 'Invalid workflow status request.' }, { status: 400, headers });
    const signal = AbortSignal.timeout(5000);
    const { data: provider, error: providerError } = await supabaseAdmin.from('providers').select('id')
      .eq('id', providerId).eq('is_active', true).abortSignal(signal).maybeSingle();
    if (providerError) throw new Error();
    if (!provider) throw new ApiAuthorizationError(403, 'Access denied.');
    const { data, error } = await supabaseAdmin.from('report_drafts').select('id,workflow_status,updated_at')
      .eq('provider_id', providerId).is('deleted_at', null).in('id', ids).limit(activeWorkflowBatchSize).abortSignal(signal);
    if (error || !data || data.length !== ids.length) throw new Error();
    return NextResponse.json({ success: true, drafts: data }, { headers });
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 503;
    return NextResponse.json({ success: false, error: status === 401 ? 'Authentication required.'
      : status === 403 ? 'Access denied.' : 'Workflow status is temporarily unavailable.' }, { status, headers });
  }
}
