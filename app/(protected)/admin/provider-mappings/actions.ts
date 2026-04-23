"use server";

import { createClient } from "@supabase/supabase-js";
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name";

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

function isValidSourceType(
  value: string
): value is "appointments_csv" | "provider_performance_csv" {
  return value === "appointments_csv" || value === "provider_performance_csv";
}

export async function createProviderNameMapping(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  const sourceType = String(formData.get("sourceType") ?? "").trim();
  const rawProviderName = String(formData.get("rawProviderName") ?? "").trim();
  const providerId = String(formData.get("providerId") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!isValidSourceType(sourceType)) {
    return {
      ok: false,
      message: "Invalid source type.",
    };
  }

  if (!rawProviderName) {
    return {
      ok: false,
      message: "Please enter a raw provider name.",
    };
  }

  if (!providerId) {
    return {
      ok: false,
      message: "Please select a provider.",
    };
  }

  const supabase = getServiceRoleSupabaseClient();
  const normalizedProviderName = normalizeProviderName(rawProviderName);

  const { error } = await supabase.from("provider_name_mappings").upsert(
    {
      provider_id: providerId,
      source_type: sourceType,
      raw_provider_name: rawProviderName,
      normalized_provider_name: normalizedProviderName,
      notes: notes || null,
    },
    {
      onConflict: "source_type,raw_provider_name",
    }
  );

  if (error) {
    return {
      ok: false,
      message: `Failed to save provider name mapping: ${error.message}`,
    };
  }

  return {
    ok: true,
    message: `Saved mapping for "${rawProviderName}".`,
  };
}