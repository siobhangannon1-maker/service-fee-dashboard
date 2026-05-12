import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { completeReferralWorkflowForInboxItem } from "@/lib/ai/brain/completeReferralWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getInitials(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();

  return "AI";
}

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    let fullName: string | null = null;

    if (user?.id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      fullName = profile?.full_name || null;
    }

    const result = await completeReferralWorkflowForInboxItem({
      inboxItemId,
      forceFile: Boolean(body.forceFile),
      createReferral: body.createReferral !== false,
      fileAttachments: body.fileAttachments !== false,
      actor: {
        userId: user?.id || null,
        email: user?.email || null,
        fullName,
        initials: getInitials(fullName, user?.email || null),
      },
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Referral workflow failed." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
