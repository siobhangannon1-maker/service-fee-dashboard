import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("referral_uploads")
    .select(
      `
      id,
      file_name,
      week_start,
      week_end,
      created_at,
      referral_records (
        id,
        referral_count
      )
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const uploads = data.map((upload: any) => {
    const totalReferrals = upload.referral_records.reduce(
      (sum: number, record: any) => sum + Number(record.referral_count || 0),
      0
    );

    return {
      id: upload.id,
      file_name: upload.file_name,
      week_start: upload.week_start,
      week_end: upload.week_end,
      created_at: upload.created_at,
      record_count: upload.referral_records.length,
      total_referrals: totalReferrals,
    };
  });

  return NextResponse.json({ uploads });
}