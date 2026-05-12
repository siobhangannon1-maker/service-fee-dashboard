import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      inboxItemId: string;
    }>;
  }
) {
  try {
    const { inboxItemId } = await context.params;

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inbox item ID." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ai_workbench_audit_events")
      .select(
        "id, created_at, event_type, event_label, details, actor_user_id, actor_email, actor_full_name, actor_initials"
      )
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      events: data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to load audit trail.",
      },
      { status: 500 }
    );
  }
}