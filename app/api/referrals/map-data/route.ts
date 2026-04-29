import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  let query = supabase
    .from("referral_records")
    .select(`
      id,
      referral_count,
      referral_week_start,
      referral_week_end,
      referrers (
        id,
        clinic_name,
        address,
        suburb,
        post_code,
        state,
        latitude,
        longitude
      )
    `);

  if (start) {
    query = query.gte("referral_week_start", start);
  }

  if (end) {
    query = query.lte("referral_week_end", end);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const grouped = new Map();

  for (const record of data || []) {
    const referrer: any = record.referrers;

    if (!referrer?.latitude || !referrer?.longitude) continue;

    const existing = grouped.get(referrer.id);

    if (existing) {
      existing.referral_count += Number(record.referral_count || 0);
    } else {
      grouped.set(referrer.id, {
        referrer_id: referrer.id,
        clinic_name: referrer.clinic_name,
        address: referrer.address,
        suburb: referrer.suburb,
        post_code: referrer.post_code,
        state: referrer.state,
        latitude: referrer.latitude,
        longitude: referrer.longitude,
        referral_count: Number(record.referral_count || 0),
      });
    }
  }

  return NextResponse.json({
    mapData: Array.from(grouped.values()),
  });
}