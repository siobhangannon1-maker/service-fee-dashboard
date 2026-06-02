import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json(
      { error: "Conversation is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("reception_conversation_notes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.conversationId || !body.body?.trim()) {
    return NextResponse.json(
      { error: "Conversation and note are required." },
      { status: 400 }
    );
  }

  const staff = await getStaffDisplayInfo(user.id);

  const { data: note, error } = await supabaseAdmin
    .from("reception_conversation_notes")
    .insert({
      conversation_id: body.conversationId,
      body: body.body.trim(),
      created_by_user_id: user.id,
      created_by_display_name: staff.displayName,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: body.conversationId,
    actor_user_id: user.id,
    actor_display_name: staff.displayName,
    action: "internal_note_added",
    details: {
      note_id: note.id,
      body: body.body.trim(),
    },
  });

  return NextResponse.json({ note });
}