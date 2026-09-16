import { NextResponse } from 'next/server';
import { ApiAuthorizationError, requireActiveApiUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toDraftDetail } from '@/lib/report-writing/draft-contract';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  try {
    const { user, supabase } = await requireActiveApiUser();
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return NextResponse.json({ success: false, error: 'Invalid draft ID.' }, { status: 400, headers });
    const signal = AbortSignal.timeout(10000);
    const { data: role, error: roleError } = await supabase.from('user_roles').select('role')
      .eq('user_id', user.id).abortSignal(signal).maybeSingle();
    if (roleError || !role) throw new ApiAuthorizationError(403, 'Access denied.');
    const { data: draft, error } = await supabaseAdmin.from('report_drafts').select('*')
      .eq('id', id).is('deleted_at', null).abortSignal(signal).maybeSingle();
    if (error) throw new Error();
    if (!draft) return NextResponse.json({ success: false, error: 'Draft is unavailable.' }, { status: 404, headers });
    const { data: provider, error: providerError } = await supabaseAdmin.from('providers').select('id,user_id')
      .eq('id', draft.provider_id).eq('is_active', true).abortSignal(signal).maybeSingle();
    if (providerError) throw new Error();
    // Typist access spans active providers. Provider review retains its existing
    // providers.user_id linkage; the browser cannot supply the authorizing provider.
    if (!provider || (!['admin', 'super_admin', 'practice_manager', 'typist'].includes(role.role) && provider.user_id !== user.id))
      throw new ApiAuthorizationError(403, 'Access denied.');
    return NextResponse.json({ success: true, draft: toDraftDetail(draft) }, { headers });
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 503;
    return NextResponse.json({ success: false, error: status === 401 ? 'Authentication required.'
      : status === 403 ? 'Access denied.' : 'Letter could not be loaded. Please select it again.' }, { status, headers });
  }
}
