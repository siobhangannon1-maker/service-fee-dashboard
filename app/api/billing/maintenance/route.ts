import { NextResponse } from "next/server";
import { requireActiveApiUser, ApiAuthorizationError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function respond(request?: Request) {
  try {
    const { user } = await requireActiveApiUser(["admin", "super_admin"]);
    let enabled: boolean | undefined;
    if (request) {
      const body = await request.json();
      if (typeof body.enabled !== "boolean")
        return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
      enabled = body.enabled;
    }
    const result = enabled === undefined
      ? await supabaseAdmin.rpc("billing_rollout_status")
      : await supabaseAdmin.rpc("set_billing_rollout_maintenance", { p_enabled: enabled, p_actor: user.id });
    if (result.error)
      return NextResponse.json({ error: "Maintenance state could not be confirmed. Active exports or invoice locks may require review; do not begin migrations." }, { status: 503 });
    return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiAuthorizationError ? error.message : "Maintenance controls unavailable; do not begin migrations." }, { status: error instanceof ApiAuthorizationError ? error.status : 503 });
  }
}
export async function GET() { return respond(); }
export async function POST(request: Request) { return respond(request); }
