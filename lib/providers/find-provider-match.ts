import { createClient } from "@supabase/supabase-js";
import {
  createBaseProviderName,
  normalizeProviderName,
} from "./normalize-provider-name";

type ProviderMatchResult = {
  providerId: string | null;
  providerNameRaw: string;
  providerNameNormalized: string;
  providerBaseName: string;
  matchedBy: "exact_mapping" | "none";
};

type ProviderNameMappingRow = {
  provider_id: string;
  raw_provider_name: string;
  normalized_provider_name: string;
};

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

/**
 * Matches an imported provider name using the explicit mapping table.
 *
 * Source types supported:
 * - appointments_csv
 * - provider_performance_csv
 *
 * This helper intentionally uses explicit mappings as the source of truth.
 * We do NOT auto-match by base name because that could create incorrect links.
 */
export async function findProviderMatch(params: {
  providerNameRaw: string | null | undefined;
  sourceType: "appointments_csv" | "provider_performance_csv";
}): Promise<ProviderMatchResult> {
  const providerNameRaw = params.providerNameRaw?.trim() ?? "";
  const providerNameNormalized = normalizeProviderName(providerNameRaw);
  const providerBaseName = createBaseProviderName(providerNameRaw);

  if (!providerNameRaw) {
    return {
      providerId: null,
      providerNameRaw: "",
      providerNameNormalized: "",
      providerBaseName: "",
      matchedBy: "none",
    };
  }

  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name")
    .eq("source_type", params.sourceType)
    .eq("normalized_provider_name", providerNameNormalized)
    .maybeSingle<ProviderNameMappingRow>();

  if (error) {
    throw new Error(`Failed to match provider name: ${error.message}`);
  }

  if (!data) {
    return {
      providerId: null,
      providerNameRaw,
      providerNameNormalized,
      providerBaseName,
      matchedBy: "none",
    };
  }

  return {
    providerId: data.provider_id,
    providerNameRaw,
    providerNameNormalized,
    providerBaseName,
    matchedBy: "exact_mapping",
  };
}