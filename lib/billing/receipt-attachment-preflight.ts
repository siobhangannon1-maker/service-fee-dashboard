import "server-only";
import { loadInvoiceReceipts } from "./receipt-destinations";
import { xeroFetch } from "@/lib/xero";
import { receiptAttachmentName, type Receipt } from "./receipt-contract";
import { assertAttachmentCapacity } from "./attachment-capacity";
import type { InvoiceRun } from "./xero-invoice-runs";
export async function preflightReceiptAttachments(
  run: InvoiceRun,
  standardNames: readonly string[],
  snapshot?: Receipt[],
) {
  let receipts = snapshot;
  if (!receipts) receipts = await loadInvoiceReceipts(run);
  let existing: string[] = [];
  if (run.invoice_id) {
    const response = await xeroFetch(
      `/Invoices/${encodeURIComponent(run.invoice_id)}/Attachments`,
    );
    if (
      !Array.isArray(response?.Attachments) ||
      response.Attachments.some((a: { FileName?: string }) => !a.FileName)
    )
      throw new Error(
        "Existing Xero attachment count could not be verified. No files were exported.",
      );
    existing = response.Attachments.map(
      (a: { FileName: string }) => a.FileName,
    );
  }
  assertAttachmentCapacity(
    receipts.map((r) => r.attachment_filename || receiptAttachmentName(r)),
    standardNames,
    existing,
  );
  return receipts;
}
