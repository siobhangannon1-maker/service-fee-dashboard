import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuditActor } from "@/lib/report-writing/audit";
import { getUserStatus } from "@/lib/getUserStatus";
import { safeToolsStatus } from "@/lib/mediref/tools-status";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const actor = await getAuditActor();
    if (!actor.actorUserId) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    if (!await getUserStatus(actor.actorUserId)) return NextResponse.json({ ok: false, error: "Account is inactive." }, { status: 403 });
    // Do not use getMedirefSession: it creates a session when missing. This endpoint is read-only.
    const [session, job] = await Promise.all([
      supabaseAdmin.from("mediref_sessions").select("status,refreshed_at,last_used_at,updated_at,helper_instance_id,helper_heartbeat_at,helper_expires_at,helper_stopping_at,authenticated_instance_id,authenticated_at").eq("scope", "practice").is("app_user_id", null).maybeSingle(),
      supabaseAdmin.from("mediref_helper_jobs").select("status,job_type,error,created_at,updated_at").is("app_user_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (session.error || job.error) throw new Error("Status unavailable");
    return NextResponse.json(safeToolsStatus(session.data, job.data), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to load MediRef status." }, { status: 500 });
  }
}
