import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name";

type RawRow = Record<string, string>;

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function parseDate(value: string): string {
  const trimmed = value.trim();

  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }

  const [, dd, mm, yyyy] = match;

  return `${yyyy}-${mm}-${dd}`;
}

export async function importProviderCancellationsFtasCsv(params: {
  filePath: string;
  sourceFileName: string;
}) {
  const supabase = getClient();

  const fileContent = fs.readFileSync(params.filePath, "utf-8");

  const rows: RawRow[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });

  const importBatchId = crypto.randomUUID();

  const insertRows = rows.map((row, index) => {
    const providerName = row["Provider Name"] || row["Provider"] || "";
    const status = (row["Status"] || "").toLowerCase();
    const nextAppt = row["Next Appointment"] || "";
    const dateJoined = row["Date"] || row["Date Joined"] || "";

    return {
      import_batch_id: importBatchId,
      source_file_name: params.sourceFileName,

      provider_name_raw: providerName,
      provider_name_normalized: normalizeProviderName(providerName),

      event_date: parseDate(dateJoined),

      status,

      is_fta: status.includes("fta"),
      is_cancel_no_rebook:
        status.includes("cancel") && !nextAppt,

      created_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("provider_cancellations_ftas_raw")
    .insert(insertRows);

  if (error) {
    throw new Error(`Insert failed: ${error.message}`);
  }

  return {
    importBatchId,
    sourceFileName: params.sourceFileName,
    insertedCount: insertRows.length,
    unmatchedProviders: [],
  };
}