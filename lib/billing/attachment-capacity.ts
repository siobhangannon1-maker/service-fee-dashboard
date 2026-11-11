export const XERO_INVOICE_ATTACHMENT_LIMIT = 10;
export class AttachmentCapacityError extends Error {
  constructor(public required: number) {
    super(
      `This invoice requires ${required} attachments, including the statement and production report. Xero permits ${XERO_INVOICE_ATTACHMENT_LIMIT}. No files were exported. Reduce the receipt count or review existing Xero attachments before retrying.`,
    );
  }
}
export function assertAttachmentCapacity(
  receiptNames: string[],
  standardNames: readonly string[],
  existingNames: string[] = [],
) {
  // Stable filenames already on the invoice consume one slot, including retries.
  const required = new Set([
    ...existingNames,
    ...standardNames,
    ...receiptNames,
  ]).size;
  if (required > XERO_INVOICE_ATTACHMENT_LIMIT)
    throw new AttachmentCapacityError(required);
  return required;
}
