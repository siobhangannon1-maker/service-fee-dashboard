import "server-only";

import { createClient } from "@supabase/supabase-js";
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name";
import type { ProductionReportLine } from "@/lib/praktika/fetchCompletedProceduresReport";

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

type ProviderNameMapping = {
  provider_id: string;
  raw_provider_name: string | null;
  normalized_provider_name: string | null;
};

export async function getPraktikaCompletedProcedureMappings() {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name")
    .eq("source_type", "praktika_completed_procedures");

  if (error) {
    throw new Error(`Failed to load provider mappings: ${error.message}`);
  }

  return (data || []) as ProviderNameMapping[];
}

export function filterProductionRowsForProvider(params: {
  providerId: string;
  rows: ProductionReportLine[];
  mappings: ProviderNameMapping[];
}) {
  const matchingProviderNames = new Set(
    params.mappings
      .filter((mapping) => mapping.provider_id === params.providerId)
      .flatMap((mapping) => [
        mapping.raw_provider_name || "",
        mapping.normalized_provider_name || "",
      ])
      .filter(Boolean)
      .map((name) => normalizeProviderName(name))
  );

  if (matchingProviderNames.size === 0) {
    return [];
  }

  return params.rows.filter((row) =>
    matchingProviderNames.has(normalizeProviderName(row.providerName))
  );
}
