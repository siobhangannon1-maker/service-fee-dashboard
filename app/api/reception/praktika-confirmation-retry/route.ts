import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writePraktikaConfirmationBack } from "@/lib/reception/praktika-writeback";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const conversationId = body.conversationId
    ? String(body.conversationId)
    : "";
  const appointmentId = body.appointmentId ? String(body.appointmentId) : "";

  if (!conversationId || !appointmentId) {
    return NextResponse.json(
      { error: "Conversation ID and appointment ID are required." },
      { status: 400 }
    );
  }

  const { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 }
    );
  }

  const result = await writePraktikaConfirmationBack({
    conversationId,
    appointmentId,
    note: "Confirmed YES via text message",
  });

  return NextResponse.json({
    ok: result.errors.length === 0,
    result,
  });
}
