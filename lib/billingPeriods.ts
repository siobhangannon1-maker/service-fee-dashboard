import { createClient } from "@/lib/supabase/client";

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
  status: string;
  locked_at?: string | null;
  locked_by?: string | null;
};

function getCurrentBillingMonthInfo() {
  const now = new Date();

  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const label = now.toLocaleString("en-AU", {
    month: "long",
    year: "numeric",
  });

  return { month, year, label };
}

export async function ensureCurrentBillingPeriod() {
  const supabase = createClient();
  const { month, year, label } = getCurrentBillingMonthInfo();

  const { data: existing, error: existingError } = await supabase
    .from("billing_periods")
    .select("*")
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    return existing as BillingPeriod;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("billing_periods")
    .insert({
      month,
      year,
      label,
      status: "open",
      locked_at: null,
      locked_by: null,
    })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return inserted as BillingPeriod;
}

export async function createNextBillingPeriodFromList(periods: BillingPeriod[]) {
  const supabase = createClient();

  if (!periods.length) {
    throw new Error("No existing billing periods found.");
  }

  const sorted = [...periods].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  const latest = sorted[sorted.length - 1];

  let nextMonth = latest.month + 1;
  let nextYear = latest.year;

  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const label = new Date(nextYear, nextMonth - 1).toLocaleString("en-AU", {
    month: "long",
    year: "numeric",
  });

  const { data: existing, error: existingError } = await supabase
    .from("billing_periods")
    .select("*")
    .eq("month", nextMonth)
    .eq("year", nextYear)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    return existing as BillingPeriod;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("billing_periods")
    .insert({
      month: nextMonth,
      year: nextYear,
      label,
      status: "open",
      locked_at: null,
      locked_by: null,
    })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return inserted as BillingPeriod;
}