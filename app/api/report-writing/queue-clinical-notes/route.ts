import { NextResponse } from "next/server";
import { ApiAuthorizationError, requireActiveApiUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireActiveApiUser();
    const params = new URL(request.url).searchParams;
    const providerId = params.get("providerId") || "", queueId = params.get("queueId") || "";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(providerId) || !uuid.test(queueId))
      return NextResponse.json({ success: false, error: "Invalid queue selection." }, { status: 400, headers });
    const signal = AbortSignal.timeout(10000);
    const role = await supabase.from("user_roles").select("role").eq("user_id", user.id).abortSignal(signal).maybeSingle();
    if (role.error || !role.data) throw new ApiAuthorizationError(403, "Access denied.");
    const provider = await supabaseAdmin.from("providers").select("id,user_id").eq("id", providerId)
      .eq("is_active", true).abortSignal(signal).maybeSingle();
    if (provider.error) throw new Error();
    if (!provider.data || (!['admin', 'super_admin', 'practice_manager', 'typist'].includes(role.data.role) && provider.data.user_id !== user.id))
      throw new ApiAuthorizationError(403, "Access denied.");
    const row = await supabaseAdmin.from("report_letter_queue").select("raw_json")
      .eq("id", queueId).eq("provider_id", providerId).abortSignal(signal).maybeSingle();
    if (row.error) throw new Error();
    if (!row.data) return NextResponse.json({ success: false, error: "Queue item is unavailable." }, { status: 404, headers });
    const raw = row.data.raw_json as Record<string, unknown> | null;
    // Only the canonical cached field. source_clinical_notes and appointment
    // notes can contain administrative text and are deliberately not returned.
    const clinicalNotes = typeof raw?.cached_clinical_notes === "string" ? raw.cached_clinical_notes.trim() : "";
    return NextResponse.json({ success: true, providerId, queueId, clinicalNotes }, { headers });
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 503;
    return NextResponse.json({ success: false, error: status === 401 ? "Authentication required."
      : status === 403 ? "Access denied." : "Clinical notes could not be loaded. Please retry." }, { status, headers });
  }
}
