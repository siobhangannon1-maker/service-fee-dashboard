import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const formData = await request.formData();

    const id = String(formData.get("id") || "");
    const isActive =
      String(formData.get("is_active") || "false") === "true";

    if (!id) {
      return NextResponse.json(
        { error: "Missing rule id." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("ai_learning_rules")
      .update({
        is_active: isActive,
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.redirect(
      new URL("/ai/learning-rules", request.url)
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to toggle learning rule.",
      },
      { status: 500 }
    );
  }
}