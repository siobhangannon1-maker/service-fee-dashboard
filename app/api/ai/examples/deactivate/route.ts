import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await req.json();
    const id = body?.id;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing example ID." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("ai_approved_examples")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Example removed.",
    });
  } catch (error: any) {
    console.error("Deactivate example error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to remove example.",
      },
      { status: 500 }
    );
  }
}