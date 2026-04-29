"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export type DeleteImportType =
  | "appointments"
  | "performance"
  | "cancellations"
  | "new_patients";

type BatchRow = {
  import_batch_id: string;
  import_type: DeleteImportType;
  month_key: string | null;
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

function isValidImportType(value: string): value is DeleteImportType {
  return (
    value === "appointments" ||
    value === "performance" ||
    value === "cancellations" ||
    value === "new_patients"
  );
}

function getRawTableName(importType: DeleteImportType): string {
  if (importType === "appointments") return "provider_appointments_raw";
  if (importType === "performance") return "provider_performance_raw";
  if (importType === "cancellations") return "provider_cancellations_ftas_raw";
  return "provider_new_patients_raw";
}

export async function deleteImportBatch(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const importType = String(formData.get("importType") ?? "").trim();

  if (!batchId) {
    throw new Error("Missing batchId");
  }

  if (!isValidImportType(importType)) {
    throw new Error("Invalid importType");
  }

  const supabase = getClient();

  const { data: batches, error: batchLookupError } = await supabase
    .from("provider_import_batches")
    .select("import_batch_id, import_type, month_key")
    .eq("import_batch_id", batchId)
    .eq("import_type", importType);

  if (batchLookupError) {
    throw new Error(`Failed to load batch record: ${batchLookupError.message}`);
  }

  const batchRows = (batches ?? []) as BatchRow[];

  if (batchRows.length === 0) {
    throw new Error("Batch not found. It may have already been deleted.");
  }

  const rawTableName = getRawTableName(importType);

  const { error: rawDeleteError } = await supabase
    .from(rawTableName)
    .delete()
    .eq("import_batch_id", batchId);

  if (rawDeleteError) {
    throw new Error(`Failed to delete ${importType} rows: ${rawDeleteError.message}`);
  }

  const { error: batchDeleteError } = await supabase
    .from("provider_import_batches")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("import_type", importType);

  if (batchDeleteError) {
    throw new Error(`Failed to delete import batch records: ${batchDeleteError.message}`);
  }

  revalidatePath("/admin/provider-imports");
  revalidatePath("/provider");
  revalidatePath("/admin/provider-dashboard");
  revalidatePath("/practice-manager/kpis");
}
