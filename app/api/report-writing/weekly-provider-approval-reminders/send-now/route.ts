import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendWeeklyProviderApprovalReminders } from "@/lib/report-writing/provider-approval-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized.");
  }

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roleRow || !["admin", "super_admin"].includes(roleRow.role)) {
    throw new Error("Only admins can send weekly reminder SMS messages.");
  }

  return user;
}

export async function POST() {
  try {
    const user = await requireAdmin();

    const result = await sendWeeklyProviderApprovalReminders();

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: user.id,
      action: "weekly_provider_approval_sms_sent_manually",
      metadata: {
        sent: result.sent,
        results: result.results,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send weekly reminders.",
      },
      { status: 500 },
    );
  }
}