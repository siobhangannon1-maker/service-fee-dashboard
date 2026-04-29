import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ExpenseBenchmarkRow = {
  id?: number | null;
  category_name: string;
  target_percent: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
  created_at?: string;
  updated_at?: string;
  green_heading?: string;
  green_intro?: string;
  green_actions_text?: string;
  orange_heading?: string;
  orange_intro?: string;
  orange_actions_text?: string;
  red_heading?: string;
  red_intro?: string;
  red_actions_text?: string;
};

const BENCHMARKS_TABLE = "expense_benchmarks";

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

function mapRow(row: any): ExpenseBenchmarkRow {
  return {
    id: row.id ?? null,
    category_name: normalizeText(row.category_name),
    target_percent: normalizeNumber(row.target_percent),
    green_min: normalizeNumber(row.green_min),
    green_max: normalizeNumber(row.green_max),
    orange_min: normalizeNumber(row.orange_min),
    orange_max: normalizeNumber(row.orange_max),
    red_min: normalizeNumber(row.red_min),
    created_at: row.created_at,
    updated_at: row.updated_at,
    green_heading: row.green_heading ?? "",
    green_intro: row.green_intro ?? "",
    green_actions_text: row.green_actions_text ?? "",
    orange_heading: row.orange_heading ?? "",
    orange_intro: row.orange_intro ?? "",
    orange_actions_text: row.orange_actions_text ?? "",
    red_heading: row.red_heading ?? "",
    red_intro: row.red_intro ?? "",
    red_actions_text: row.red_actions_text ?? "",
  };
}

function validateRows(rows: ExpenseBenchmarkRow[]) {
  for (const row of rows) {
    if (!normalizeText(row.category_name)) {
      throw new Error("Each benchmark row must have a category name.");
    }
  }

  const seen = new Set<string>();

  for (const row of rows) {
    const key = normalizeText(row.category_name).toLowerCase();

    if (seen.has(key)) {
      throw new Error(`Duplicate benchmark category: ${row.category_name}`);
    }

    seen.add(key);
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from(BENCHMARKS_TABLE)
    .select("*")
    .order("category_name", { ascending: true });

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

    const renamedMappings: Array<{ oldName: string; newName: string }> = [];

    for (const row of rows) {
      const payload = {
        category_name: normalizeText(row.category_name),
        target_percent: normalizeNumber(row.target_percent),
        green_min: normalizeNumber(row.green_min),
        green_max: normalizeNumber(row.green_max),
        orange_min: normalizeNumber(row.orange_min),
        orange_max: normalizeNumber(row.orange_max),
        red_min: normalizeNumber(row.red_min),
        green_heading: normalizeText(row.green_heading),
        green_intro: normalizeText(row.green_intro),
        green_actions_text: normalizeText(row.green_actions_text),
        orange_heading: normalizeText(row.orange_heading),
        orange_intro: normalizeText(row.orange_intro),
        orange_actions_text: normalizeText(row.orange_actions_text),
        red_heading: normalizeText(row.red_heading),
        red_intro: normalizeText(row.red_intro),
        red_actions_text: normalizeText(row.red_actions_text),
      };

      if (row.id) {
        const { data: existingRow } = await supabase
          .from(BENCHMARKS_TABLE)
          .select("category_name")
          .eq("id", row.id)
          .single();

        if (
          existingRow?.category_name &&
          existingRow.category_name !== payload.category_name
        ) {
          renamedMappings.push({
            oldName: existingRow.category_name,
            newName: payload.category_name,
          });
        }

        const { error } = await supabase
          .from(BENCHMARKS_TABLE)
          .update(payload)
          .eq("id", row.id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } else {
        const { error } = await supabase.from(BENCHMARKS_TABLE).insert(payload);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    const { data: refreshedRows, error: reloadError } = await supabase
      .from(BENCHMARKS_TABLE)
      .select("*")
      .order("category_name", { ascending: true });

    if (reloadError) {
      return NextResponse.json({ error: reloadError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: (refreshedRows || []).map(mapRow),
      renamedMappings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save expense benchmarks.",
      },
      { status: 500 }
    );
  }
}