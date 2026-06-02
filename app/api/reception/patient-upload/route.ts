import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const {
    token,
    fileName,
    fileType,
    fileSize,
    storagePath,
    publicUrl,
  } = body;

  if (!token || !fileName || !storagePath || !publicUrl) {
    return NextResponse.json(
      { error: "Missing upload details." },
      { status: 400 }
    );
  }

  const { data: uploadLink, error: linkError } = await supabaseAdmin
    .from("reception_patient_upload_links")
    .select("*")
    .eq("token", token)
    .eq("status", "active")
    .single();

  if (linkError || !uploadLink) {
    return NextResponse.json(
      { error: "Upload link is invalid or expired." },
      { status: 404 }
    );
  }

  if (uploadLink.expires_at && new Date(uploadLink.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Upload link has expired." },
      { status: 410 }
    );
  }

  const { data: message, error: messageError } = await supabaseAdmin
    .from("reception_messages")
    .insert({
      conversation_id: uploadLink.conversation_id,
      direction: "inbound",
      body: "Patient uploaded a file",
      twilio_status: "received",
      message_source: "manual",
    })
    .select("*")
    .single();

  if (messageError || !message) {
    return NextResponse.json(
      { error: messageError?.message || "Could not save message." },
      { status: 500 }
    );
  }

  const { error: attachmentError } = await supabaseAdmin
    .from("reception_message_attachments")
    .insert({
      message_id: message.id,
      conversation_id: uploadLink.conversation_id,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      storage_path: storagePath,
      public_url: publicUrl,
    });

  if (attachmentError) {
    return NextResponse.json(
      { error: attachmentError.message },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("reception_conversations")
    .update({
      status: "open",
      last_message_preview: "Patient uploaded a file",
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadLink.conversation_id);

  await supabaseAdmin
    .from("reception_patient_upload_links")
    .update({
      used_at: new Date().toISOString(),
    })
    .eq("id", uploadLink.id);

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: uploadLink.conversation_id,
    message_id: message.id,
    action: "patient_file_uploaded",
    details: {
      fileName,
      fileType,
      fileSize,
      storagePath,
      publicUrl,
    },
  });

  return NextResponse.json({
    ok: true,
    message,
  });
}