import { MAX_RECEIPT_BYTES } from "./receipt-contract";
export class ReceiptUploadError extends Error {
  constructor(
    public status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}
// Enforce the bound before multipart parsing, including requests without Content-Length.
export async function readReceiptForm(request: Request): Promise<FormData> {
  const limit = MAX_RECEIPT_BYTES + 100_000;
  const oversized = () =>
    new ReceiptUploadError(413, "Maximum receipt size is 3 MB.");
  if (Number(request.headers.get("content-length")) > limit) throw oversized();
  if (!request.body)
    throw new ReceiptUploadError(400, "Receipt file is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw oversized();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Request("https://receipt-upload.invalid", {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "" },
      body: Buffer.concat(chunks),
    }).formData();
  } catch {
    throw new ReceiptUploadError(400, "Invalid receipt upload form.");
  }
}
