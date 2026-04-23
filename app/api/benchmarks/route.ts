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
  green_heading?: string | null;
  green_intro?: string | null;
  green_actions_text?: string | null;
  orange_heading?: string | null;
  orange_intro?: string | null;
  orange_actions_text?: string | null;
  red_heading?: string | null;
  red_intro?: string | null;
  red_actions_text?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ExistingBenchmarkRow = {
  id: number;
  category_name: string;
};

const BENCHMARKS_TABLE = "expense_benchmarks";
const XERO_MAPPINGS_TABLE = "xero_account_mappings";

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

function normalizeActionsText(value: unknown) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeCategoryNameForCompare(value: unknown) {
  return normalizeText(value).toLowerCase();
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
    green_heading: normalizeText(row.green_heading),
    green_intro: normalizeText(row.green_intro),
    green_actions_text: normalizeActionsText(row.green_actions_text),
    orange_heading: normalizeText(row.orange_heading),
    orange_intro: normalizeText(row.orange_intro),
    orange_actions_text: normalizeActionsText(row.orange_actions_text),
    red_heading: normalizeText(row.red_heading),
    red_intro: normalizeText(row.red_intro),
    red_actions_text: normalizeActionsText(row.red_actions_text),
    created_at: row.created_at,
    updated_at: row.updated_at,
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
    const normalized = normalizeCategoryNameForCompare(row.category_name);

    if (seen.has(normalized)) {
      throw new Error(`Duplicate benchmark category name: ${row.category_name}`);
    }

    seen.add(normalized);
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

    const { data: existingRows, error: existingRowsError } = await supabase
      .from(BENCHMARKS_TABLE)
      .select("id, category_name");

    if (existingRowsError) {
      return NextResponse.json({ error: existingRowsError.message }, { status: 500 });
    }

    const existingById = new Map<number, ExistingBenchmarkRow>();

    for (const row of (existingRows || []) as ExistingBenchmarkRow[]) {
      existingById.set(row.id, row);
    }

    const renamePairs: Array<{ oldName: string; newName: string }> = [];

    for (const row of rows) {
      if (!row.id) continue;

      const existingRow = existingById.get(row.id);
      if (!existingRow) continue;

      const oldName = normalizeText(existingRow.category_name);
      const newName = normalizeText(row.category_name);

      if (
        oldName &&
        newName &&
        normalizeCategoryNameForCompare(oldName) !== normalizeCategoryNameForCompare(newName)
      ) {
        renamePairs.push({
          oldName,
          newName,
        });
      }
    }

    const payload = rows.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      category_name: normalizeText(row.category_name),
      target_percent: row.target_percent,
      green_min: row.green_min,
      green_max: row.green_max,
      orange_min: row.orange_min,
      orange_max: row.orange_max,
      red_min: row.red_min,
      green_heading: row.green_heading ? normalizeText(row.green_heading) : null,
      green_intro: row.green_intro ? normalizeText(row.green_intro) : null,
      green_actions_text: row.green_actions_text
        ? normalizeActionsText(row.green_actions_text)
        : null,
      orange_heading: row.orange_heading ? normalizeText(row.orange_heading) : null,
      orange_intro: row.orange_intro ? normalizeText(row.orange_intro) : null,
      orange_actions_text: row.orange_actions_text
        ? normalizeActionsText(row.orange_actions_text)
        : null,
      red_heading: row.red_heading ? normalizeText(row.red_heading) : null,
      red_intro: row.red_intro ? normalizeText(row.red_intro) : null,
      red_actions_text: row.red_actions_text ? normalizeActionsText(row.red_actions_text) : null,
    }));

    const { error: upsertError } = await supabase
      .from(BENCHMARKS_TABLE)
      .upsert(payload, { onConflict: "id" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    for (const rename of renamePairs) {
      const { error: mappingRenameError } = await supabase
        .from(XERO_MAPPINGS_TABLE)
        .update({
          benchmark_category_name: rename.newName,
        })
        .eq("benchmark_category_name", rename.oldName);

      if (mappingRenameError) {
        return NextResponse.json(
          {
            error: `Benchmarks were saved, but failed to update mappings from "${rename.oldName}" to "${rename.newName}": ${mappingRenameError.message}`,
          },
          { status: 500 }
        );
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
      renamedMappings: renamePairs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save benchmarks.",
      },
      { status: 500 }
    );
  }
}