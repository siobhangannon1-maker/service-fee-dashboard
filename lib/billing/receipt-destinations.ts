import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import type { Receipt, ReceiptDestination } from "./receipt-contract";
import type { InvoiceRun } from "./xero-invoice-runs";
export async function loadInvoiceReceipts(run: InvoiceRun): Promise<Receipt[]> {
  const response = await db
    .from("incorrect_payment_receipt_destinations")
    .select("*, receipt:incorrect_payment_receipts!inner(*)")
    .eq("provider_id", run.provider_id)
    .eq("receipt.billing_period_id", run.billing_period_id)
    .is("receipt.deleted_at", null)
    .neq("receipt.status", "deleting")
    .in("status", ["pending", "failed", "attaching", "attached"]);
  if (response.error)
    throw new Error(
      "Receipt destinations could not be loaded. No required receipts were omitted; please retry.",
    );
  const rows = (response.data || []) as (ReceiptDestination & {
    receipt: Receipt;
  })[];
  const ids = [
    ...new Set(
      rows
        .map((d) => d.receipt.patient_financial_entry_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const entries = ids.length
    ? await db
        .from("patient_financial_entries")
        .select(
          "id,provider_id,related_provider_id,billing_period_id,category,deleted_at",
        )
        .in("id", ids)
    : { data: [], error: null };
  if (entries.error)
    throw new Error(
      "Receipt financial-entry associations could not be verified.",
    );
  const output: Receipt[] = [];
  for (const destination of rows) {
    const receipt = destination.receipt;
    if (receipt.intended_provider_id) {
      const entry = entries.data?.find(
        (e) => e.id === receipt.patient_financial_entry_id,
      );
      if (entry?.deleted_at) continue; // Deleted financial entries do not contribute to billing.
      if (
        !entry ||
        entry.category !== "paid_to_wrong_provider" ||
        entry.provider_id !== receipt.provider_id ||
        entry.related_provider_id !== receipt.intended_provider_id ||
        entry.billing_period_id !== receipt.billing_period_id
      )
        throw new Error(
          "Receipt provider/entry associations need administrator review before export.",
        );
    }
    output.push({
      ...receipt,
      provider_id: destination.provider_id,
      status: destination.status,
      invoice_run_id: destination.invoice_run_id,
      xero_invoice_id: destination.xero_invoice_id,
      xero_attachment_id: destination.xero_attachment_id,
      attachment_filename: destination.attachment_filename,
      attached_at: destination.attached_at,
      last_error: destination.last_error,
    });
  }
  return output;
}
