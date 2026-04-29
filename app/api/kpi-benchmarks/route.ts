import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type MetricType = "percentage" | "number" | "currency" | "hours";

type PracticeKpiBenchmarkRow = {
  id?: string | number | null;
  metric_key: string;
  metric_label: string;
  metric_type: MetricType;
  higher_is_better: boolean;
  target_value: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
  created_at?: string;
  updated_at?: string;
};

const BENCHMARKS_TABLE = "practice_kpi_benchmarks";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function normalizeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeBoolean(value: unknown) {
  return Boolean(value);
}

function normalizeMetricType(value: unknown): MetricType {
  const metricType = normalizeText(value);

  if (
    metricType === "percentage" ||
    metricType === "number" ||
    metricType === "currency" ||
    metricType === "hours"
  ) {
    return metricType;
  }

  return "number";
}

function mapRow(row: any): PracticeKpiBenchmarkRow {
  return {
    id: row.id ?? null,
    metric_key: normalizeText(row.metric_key),
    metric_label: normalizeText(row.metric_label),
    metric_type: normalizeMetricType(row.metric_type),
    higher_is_better: normalizeBoolean(row.higher_is_better),
    target_value: normalizeNumber(row.target_value),
    green_min: normalizeNumber(row.green_min),
    green_max: normalizeNumber(row.green_max),
    orange_min: normalizeNumber(row.orange_min),
    orange_max: normalizeNumber(row.orange_max),
    red_min: normalizeNumber(row.red_min),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateRows(rows: PracticeKpiBenchmarkRow[]) {
  for (const row of rows) {
    if (!normalizeText(row.metric_key)) {
      throw new Error("Each KPI benchmark row must have a metric key.");
    }

    if (!normalizeText(row.metric_label)) {
      throw new Error("Each KPI benchmark row must have a metric label.");
    }
  }

  const seen = new Set<string>();

  for (const row of rows) {
    const key = normalizeText(row.metric_key).toLowerCase();

    if (seen.has(key)) {
      throw new Error(`Duplicate KPI benchmark key: ${row.metric_key}`);
    }

    seen.add(key);
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from(BENCHMARKS_TABLE)
    .select("*")
    .order("metric_key", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data || []).map(mapRow));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows = (Array.isArray(body) ? body : []).map(mapRow);

    validateRows(rows);

    const payload = rows.map((row) => ({
      // IMPORTANT:
      // Do not include id here.
      // This prevents sending id: null into Supabase.
      metric_key: normalizeText(row.metric_key),
      metric_label: normalizeText(row.metric_label),
      metric_type: normalizeMetricType(row.metric_type),
      higher_is_better: normalizeBoolean(row.higher_is_better),
      target_value: normalizeNumber(row.target_value),
      green_min: normalizeNumber(row.green_min),
      green_max: normalizeNumber(row.green_max),
      orange_min: normalizeNumber(row.orange_min),
      orange_max: normalizeNumber(row.orange_max),
      red_min: normalizeNumber(row.red_min),
    }));

    const { error: upsertError } = await supabase
      .from(BENCHMARKS_TABLE)
      .upsert(payload, {
        onConflict: "metric_key",
      });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const { data: refreshedRows, error: reloadError } = await supabase
      .from(BENCHMARKS_TABLE)
      .select("*")
      .order("metric_key", { ascending: true });

    if (reloadError) {
      return NextResponse.json({ error: reloadError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: (refreshedRows || []).map(mapRow),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save KPI benchmarks.",
      },
      { status: 500 }
    );
  }
}