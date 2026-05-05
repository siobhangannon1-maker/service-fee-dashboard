import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ReferralRow = {
  referrer_id: string | null;
  referral_count: number | null;
  referrers: {
    clinic_name: string | null;
    suburb: string | null;
    post_code: string | null;
  } | null;
};

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function isDate(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function fetchReferralRows(start: string, end: string) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("referral_records")
    .select(
      `
      referrer_id,
      referral_count,
      referrers (
        clinic_name,
        suburb,
        post_code
      )
    `
    )
    .gte("referral_week_start", start)
    .lte("referral_week_end", end);

  if (error) throw new Error(error.message);

  return (data || []) as unknown as ReferralRow[];
}

function rankRows(rows: ReferralRow[]) {
  const grouped = new Map<
    string,
    {
      referrer_id: string;
      clinic_name: string;
      suburb: string | null;
      post_code: string | null;
      referrals: number;
    }
  >();

  for (const row of rows) {
    if (!row.referrer_id) continue;

    const existing = grouped.get(row.referrer_id);
    const referralCount = Number(row.referral_count || 0);

    if (existing) {
      existing.referrals += referralCount;
    } else {
      grouped.set(row.referrer_id, {
        referrer_id: row.referrer_id,
        clinic_name: row.referrers?.clinic_name || "Unknown referrer",
        suburb: row.referrers?.suburb || null,
        post_code: row.referrers?.post_code || null,
        referrals: referralCount,
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.referrals - a.referrals)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const mode = url.searchParams.get("mode") || "compare";

    const currentStart = url.searchParams.get("currentStart");
    const currentEnd = url.searchParams.get("currentEnd");
    const comparisonStart = url.searchParams.get("comparisonStart");
    const comparisonEnd = url.searchParams.get("comparisonEnd");

    if (!isDate(currentStart) || !isDate(currentEnd)) {
      return NextResponse.json(
        { error: "Missing or invalid current period date range." },
        { status: 400 }
      );
    }

    const currentRows = await fetchReferralRows(currentStart!, currentEnd!);
    const currentRanked = rankRows(currentRows);

    if (mode === "current") {
      return NextResponse.json({
        mode,
        results: currentRanked.map((row) => ({
          ...row,
          previous_referrals: 0,
          previous_rank: null,
          referral_change: null,
          rank_change: null,
          is_new_top_referrer: false,
          left_top_3: false,
          left_top_20: false,
        })),
        current_total_referrals: currentRanked.reduce(
          (sum, row) => sum + row.referrals,
          0
        ),
        previous_total_referrals: null,
      });
    }

    if (!isDate(comparisonStart) || !isDate(comparisonEnd)) {
      return NextResponse.json(
        { error: "Missing or invalid comparison period date range." },
        { status: 400 }
      );
    }

    const comparisonRows = await fetchReferralRows(
      comparisonStart!,
      comparisonEnd!
    );

    const comparisonRanked = rankRows(comparisonRows);
    const comparisonById = new Map(
      comparisonRanked.map((row) => [row.referrer_id, row])
    );

    const currentIds = new Set(currentRanked.map((row) => row.referrer_id));

    const results = currentRanked.map((current) => {
      const previous = comparisonById.get(current.referrer_id);

      return {
        ...current,
        previous_referrals: previous?.referrals ?? 0,
        previous_rank: previous?.rank ?? null,
        referral_change: current.referrals - (previous?.referrals ?? 0),
        rank_change:
          previous?.rank === undefined ? null : previous.rank - current.rank,
        is_new_top_referrer: !previous,
        left_top_3: false,
        left_top_20: false,
      };
    });

    const dropped = comparisonRanked
      .filter((row) => !currentIds.has(row.referrer_id))
      .map((row) => ({
        ...row,
        referrals: 0,
        rank: null,
        previous_referrals: row.referrals,
        previous_rank: row.rank,
        referral_change: -row.referrals,
        rank_change: null,
        is_new_top_referrer: false,
        left_top_3: row.rank <= 3,
        left_top_20: row.rank <= 20,
      }));

    return NextResponse.json({
      mode,
      results: [...results, ...dropped],
      current_total_referrals: currentRanked.reduce(
        (sum, row) => sum + row.referrals,
        0
      ),
      previous_total_referrals: comparisonRanked.reduce(
        (sum, row) => sum + row.referrals,
        0
      ),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load referrer performance." },
      { status: 500 }
    );
  }
}