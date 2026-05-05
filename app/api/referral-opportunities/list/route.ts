import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET() {
  try {
    const supabase = getClient();

    const { data, error } = await supabase
      .from("dental_practice_prospects")
      .select(
        `
        id,
        place_id,
        practice_name,
        address,
        suburb,
        post_code,
        state,
        latitude,
        longitude,
        google_rating,
        google_user_ratings_total,
        is_existing_referrer,
        matched_referrer_id,
        updated_at
      `
      )
      .order("is_existing_referrer", { ascending: true })
      .order("google_user_ratings_total", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      prospects: data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to load referral opportunities.",
      },
      { status: 500 }
    );
  }
}