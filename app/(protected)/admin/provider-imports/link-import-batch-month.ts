"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

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

function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export async function linkImportBatchMonth(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const monthKey = String(formData.get("monthKey") ?? "").trim();

  if (!batchId) {
    throw new Error("Missing batchId");
  }

  if (!isValidMonthKey(monthKey)) {
    throw new Error("Invalid month key");
  }

  const supabase = getClient();

  const { error } = await supabase
    .from("provider_import_batches")
    .update({
      month_key: monthKey,
      is_linked: true,
    })
    .eq("import_batch_id", batchId);

  if (error) {
    throw new Error(`Failed to link batch to month: ${error.message}`);
  }

  revalidatePath("/admin/provider-imports");
}