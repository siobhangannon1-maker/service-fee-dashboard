import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function checkAccess() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, allowed: false, status: 401, error: "Not logged in" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
    return { supabase, allowed: false, status: 403, error: "Not allowed" };
  }

  return { supabase, allowed: true, status: 200, error: null };
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = await checkAccess();

  if (!access.allowed) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const { weekStart, weekEnd } = await req.json();

  if (weekStart && weekEnd) {
    const { data: existingUpload } = await access.supabase
      .from("referral_uploads")
      .select("id")
      .eq("week_start", weekStart)
      .eq("week_end", weekEnd)
      .neq("id", id)
      .maybeSingle();

    if (existingUpload) {
      return NextResponse.json(
        { error: `Another upload is already linked to ${weekStart} to ${weekEnd}.` },
        { status: 409 }
      );
    }
  }

  const { error: uploadError } = await access.supabase
    .from("referral_uploads")
    .update({
      week_start: weekStart || null,
      week_end: weekEnd || null,
    })
    .eq("id", id);

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: recordsError } = await access.supabase
    .from("referral_records")
    .update({
      referral_week_start: weekStart || null,
      referral_week_end: weekEnd || null,
    })
    .eq("upload_id", id);

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = await checkAccess();

  if (!access.allowed) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const { count: deletedRecordsCount, error: recordsError } =
    await access.supabase
      .from("referral_records")
      .delete({ count: "exact" })
      .eq("upload_id", id);

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 500 });
  }

  const { count: deletedUploadsCount, error: uploadError } =
    await access.supabase
      .from("referral_uploads")
      .delete({ count: "exact" })
      .eq("id", id);

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deletedRecordsCount,
    deletedUploadsCount,
  });
}