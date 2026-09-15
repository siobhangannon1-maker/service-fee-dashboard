import { sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const accessDenied = await sensitiveApiAccess("/api/billing-periods");
  if (accessDenied) return accessDenied;

  try {
    const { data, error } = await supabaseAdmin
      .from("billing_periods")
      .select("id, label, month, year, status")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      billingPeriods: data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load billing periods" },
      { status: 500 }
    );
  }
}