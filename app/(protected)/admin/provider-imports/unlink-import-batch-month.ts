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

export async function unlinkImportBatchMonth(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "").trim();

  if (!batchId) {
    throw new Error("Missing batchId");
  }

  const supabase = getClient();

  const { error } = await supabase
    .from("provider_import_batches")
    .update({
      month_key: null,
      is_linked: false,
    })
    .eq("import_batch_id", batchId);

  if (error) {
    throw new Error(`Failed to unlink batch from month: ${error.message}`);
  }

  revalidatePath("/admin/provider-imports");
}