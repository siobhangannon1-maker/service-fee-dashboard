import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const uploadId = body.uploadId as string | undefined;

    if (!uploadId) {
      return NextResponse.json(
        { error: "uploadId is required." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("xero_imports")
      .update({
        billing_period_id: null,
        month: null,
        year: null,
      })
      .eq("id", uploadId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to unlink import" },
      { status: 500 }
    );
  }
}