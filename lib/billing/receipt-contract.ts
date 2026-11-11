export const RECEIPT_BUCKET = "incorrect-payment-receipts";
export const MAX_RECEIPT_BYTES = 3_000_000;
export type ReceiptStatus =
  | "draft"
  | "pending"
  | "attaching"
  | "attached"
  | "failed"
  | "deleting";
export type ReceiptDestination = {
  receipt_id: string;
  provider_id: string;
  status: ReceiptStatus;
  invoice_run_id: string | null;
  xero_invoice_id: string | null;
  attachment_filename: string | null;
  xero_attachment_id: string | null;
  attached_at: string | null;
  last_error: string | null;
  provider?: { name: string };
};
export type Receipt = {
  id: string;
  provider_id: string;
  intended_provider_id?: string | null;
  patient_financial_entry_id?: string | null;
  destinations?: ReceiptDestination[];
  linked_entry?: {
    id: string;
    receipt_required: boolean;
    deleted_at: string | null;
    category: string;
  } | null;
  can_delete?: boolean;
  invoice_run_id?: string | null;
  billing_period_id: string;
  location: "paddington" | "coorparoo" | null;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  status: ReceiptStatus;
  patient_name: string | null;
  payment_date: string | null;
  amount: number | null;
  notes: string | null;
  xero_invoice_id: string | null;
  attachment_filename: string | null;
  xero_attachment_id: string | null;
  attached_at: string | null;
  last_error: string | null;
};
export function providerStatementHeadings(name: string) {
  const doctor = `Dr ${name.trim().replace(/^(?:dr\.?\s+)+/i, "")}`;
  return [
    `Patient fees paid to Focus, owed to ${doctor}`,
    `Patient fees paid to ${doctor} in error`,
    `Patient fees paid to another provider, owed to ${doctor}`,
  ] as const;
}
export function receiptFileType(name: string, bytes: Uint8Array) {
  const ext = name.toLowerCase().split(".").pop();
  const starts = (...values: number[]) =>
    values.every((v, i) => bytes[i] === v);
  if (ext === "png" && starts(137, 80, 78, 71, 13, 10, 26, 10))
    return "image/png";
  if ((ext === "jpg" || ext === "jpeg") && starts(255, 216, 255))
    return "image/jpeg";
  if (ext === "pdf" && starts(37, 80, 68, 70, 45)) return "application/pdf";
  throw new Error("Upload a valid PNG, JPG, JPEG or PDF file.");
}
export function receiptAttachmentName(
  receipt: Pick<Receipt, "id" | "location" | "mime_type" | "sha256">,
) {
  const ext =
    receipt.mime_type === "application/pdf"
      ? "pdf"
      : receipt.mime_type === "image/png"
        ? "png"
        : "jpg";
  return `Incorrect-payment-${receipt.location ? `${receipt.location}-` : ""}${receipt.id}-${receipt.sha256.slice(0, 12)}.${ext}`;
}

export function receiptForProvider(
  receipt: Receipt,
  providerId: string,
): Receipt | null {
  if (receipt.linked_entry?.deleted_at) return null;
  const destination = receipt.destinations?.find(
    (d) => d.provider_id === providerId && d.status !== "draft",
  );
  if (receipt.destinations)
    return destination
      ? {
          ...receipt,
          provider_id: providerId,
          status:
            receipt.status === "deleting" ? "deleting" : destination.status,
          xero_invoice_id: destination.xero_invoice_id,
          xero_attachment_id: destination.xero_attachment_id,
          attachment_filename: destination.attachment_filename,
          attached_at: destination.attached_at,
          last_error: destination.last_error,
        }
      : null;
  return receipt.provider_id === providerId ? receipt : null;
}
