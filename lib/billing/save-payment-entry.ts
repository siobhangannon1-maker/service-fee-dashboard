import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { RECEIPT_BUCKET } from "./receipt-contract";
export class PaymentEntryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function savePaymentEntry(
  actorId: string,
  entryId: string,
  payload: Record<string, unknown>,
  selectedIds?: unknown,
) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(entryId) ||
    !uuid.test(String(payload.provider_id || "")) ||
    !uuid.test(String(payload.billing_period_id || "")) ||
    !String(payload.patient_name || "").trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.entry_date || "")) ||
    !Number.isFinite(Number(payload.amount))
  )
    throw new PaymentEntryError(
      400,
      "Check the provider, billing period, patient, date and amount.",
    );
  let ids: string[] | null = null;
  if (selectedIds !== undefined) {
    if (
      !Array.isArray(selectedIds) ||
      selectedIds.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      new Set(selectedIds).size !== selectedIds.length
    )
      throw new PaymentEntryError(400, "Invalid receipt selection.");
    ids = selectedIds;
  }
  const existing = await db
    .from("patient_financial_entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();
  if (existing.error)
    throw new PaymentEntryError(500, "Financial entry could not be verified.");
  const receiptQuery = ids
    ? ids.length
      ? db
          .from("incorrect_payment_receipts")
          .select("id,storage_path,file_size")
          .in("id", ids)
          .is("deleted_at", null)
      : null
    : db
        .from("incorrect_payment_receipts")
        .select("id,storage_path,file_size")
        .eq("patient_financial_entry_id", entryId)
        .is("deleted_at", null);
  const receipts = receiptQuery
    ? await receiptQuery
    : { data: [], error: null };
  if (receipts.error || (ids && receipts.data?.length !== ids.length))
    throw new PaymentEntryError(
      409,
      "Selected receipt is unavailable. Upload a receipt for this entry.",
    );
  for (const receipt of receipts.data || []) {
    const file = await db.storage
      .from(RECEIPT_BUCKET)
      .info(receipt.storage_path);
    if (
      file.error ||
      !file.data ||
      Number(file.data.size) !== receipt.file_size
    )
      throw new PaymentEntryError(
        409,
        "A selected receipt has not been stored successfully. Upload it again before saving.",
      );
  }
  const result = await db.rpc("save_incorrect_payment_entry", {
    p_actor: actorId,
    p_entry_id: entryId,
    p_payload: payload,
    p_receipt_ids: ids,
  });
  if (result.error) {
    const message = result.error.message;
    const permitted =
      /receipt|provider|billing period|review|locked|authoris|entry/i.test(
        message,
      );
    throw new PaymentEntryError(
      409,
      permitted
        ? message
        : "The entry could not be saved. Check its receipt associations and try again.",
    );
  }
  return result.data;
}
