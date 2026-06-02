import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await context.params;

  const { data: attachment, error } = await supabaseAdmin
    .from("reception_message_attachments")
    .select("*")
    .eq("id", attachmentId)
    .single();

  if (error || !attachment?.public_url) {
    return NextResponse.json(
      { error: "File not found." },
      { status: 404 }
    );
  }

  return NextResponse.redirect(attachment.public_url);
}