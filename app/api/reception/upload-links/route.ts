import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.focusdentalspecialists.com.au"
  ).replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await request.json();

  if (!conversationId) {
    return NextResponse.json(
      { error: "Conversation is required." },
      { status: 400 }
    );
  }

  const { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 }
    );
  }

  const token = crypto.randomBytes(24).toString("hex");

  const { data: uploadLink, error } = await supabaseAdmin
    .from("reception_patient_upload_links")
    .insert({
      conversation_id: conversationId,
      token,
      status: "active",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const url = `${getAppBaseUrl()}/upload/${token}`;

  return NextResponse.json({
    uploadLink,
    url,
  });
}