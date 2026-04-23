import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function getServiceRoleSupabaseClient() {
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

async function main() {
  const monthKey = process.argv[2];

  if (!monthKey) {
    throw new Error('Usage: npx tsx scripts/debug-provider-import.ts YYYY-MM');
  }

  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error("Month must be YYYY-MM");
  }

  const start = `${match[1]}-${match[2]}-01`;
  const endDate = new Date(Number(match[1]), Number(match[2]), 0);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

  const supabase = getServiceRoleSupabaseClient();

  const { data: rows, error } = await supabase
    .from("provider_appointments_raw")
    .select(`
      id,
      provider_id,
      provider_name_raw,
      provider_name_normalized,
      appointment_date,
      treatment_type,
      patient_name_raw,
      source_file_name,
      import_batch_id
    `)
    .gte("appointment_date", start)
    .lte("appointment_date", end)
    .order("provider_name_raw", { ascending: true })
    .order("appointment_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to load rows: ${error.message}`);
  }

  const allRows = rows ?? [];

  console.log("");
  console.log("========================================");
  console.log("IMPORT DEBUG");
  console.log("========================================");
  console.log("Month:", monthKey);
  console.log("Date range:", start, "to", end);
  console.log("Total raw rows found:", allRows.length);
  console.log("");

  const byProvider = new Map<
    string,
    {
      provider_name_raw: string;
      provider_name_normalized: string;
      provider_id: string | null;
      count: number;
      sampleRows: any[];
    }
  >();

  for (const row of allRows) {
    const key = row.provider_name_normalized ?? normalizeProviderName(row.provider_name_raw ?? "");
    const existing = byProvider.get(key);

    if (existing) {
      existing.count += 1;
      if (existing.sampleRows.length < 3) {
        existing.sampleRows.push(row);
      }
      continue;
    }

    byProvider.set(key, {
      provider_name_raw: row.provider_name_raw ?? "",
      provider_name_normalized: row.provider_name_normalized ?? "",
      provider_id: row.provider_id ?? null,
      count: 1,
      sampleRows: [row],
    });
  }

  const sortedProviders = Array.from(byProvider.values()).sort((a, b) =>
    a.provider_name_raw.localeCompare(b.provider_name_raw)
  );

  console.log("PROVIDERS FOUND IN RAW APPOINTMENTS");
  console.log("========================================");

  for (const provider of sortedProviders) {
    console.log("");
    console.log(`Provider Raw: ${provider.provider_name_raw}`);
    console.log(`Provider Normalized: ${provider.provider_name_normalized}`);
    console.log(`Provider ID: ${provider.provider_id}`);
    console.log(`Row Count: ${provider.count}`);
    console.log("Sample Rows:");
    for (const sample of provider.sampleRows) {
      console.log(
        JSON.stringify(
          {
            appointment_date: sample.appointment_date,
            patient_name_raw: sample.patient_name_raw,
            treatment_type: sample.treatment_type,
            source_file_name: sample.source_file_name,
            import_batch_id: sample.import_batch_id,
          },
          null,
          2
        )
      );
    }
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
    .eq("source_type", "appointments_csv")
    .order("raw_provider_name", { ascending: true });

  if (mappingsError) {
    throw new Error(`Failed to load mappings: ${mappingsError.message}`);
  }

  console.log("");
  console.log("========================================");
  console.log("APPOINTMENTS CSV MAPPINGS");
  console.log("========================================");

  for (const mapping of mappings ?? []) {
    console.log(
      JSON.stringify(
        {
          raw_provider_name: mapping.raw_provider_name,
          normalized_provider_name: mapping.normalized_provider_name,
          provider_id: mapping.provider_id,
        },
        null,
        2
      )
    );
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});