"use server";

import { createClient } from "@supabase/supabase-js";

export type ImportBatchRow = {
  id: number;
  import_batch_id: string;
  import_type: "appointments" | "performance";
  source_file_name: string;
  month_key: string | null;
  is_linked: boolean;
  created_at: string;
  row_count: number;
};

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getImportBatches(): Promise<ImportBatchRow[]> {
  const supabase = getClient();

  const { data: batches, error: batchesError } = await supabase
    .from("provider_import_batches")
    .select("id, import_batch_id, import_type, source_file_name, month_key, is_linked, created_at")
    .order("created_at", { ascending: false });

  if (batchesError) {
    throw new Error(`Failed to load import batches: ${batchesError.message}`);
  }

  const rows = (batches ?? []) as Array<{
    id: number;
    import_batch_id: string;
    import_type: "appointments" | "performance";
    source_file_name: string;
    month_key: string | null;
    is_linked: boolean;
    created_at: string;
  }>;

  const results: ImportBatchRow[] = [];

  for (const batch of rows) {
    const tableName =
      batch.import_type === "appointments"
        ? "provider_appointments_raw"
        : "provider_performance_raw";

    const { count, error: countError } = await supabase
      .from(tableName)
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", batch.import_batch_id);

    if (countError) {
      throw new Error(`Failed to count batch rows: ${countError.message}`);
    }

    results.push({
      ...batch,
      row_count: count ?? 0,
    });
  }

  return results;
}