import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfTextFromFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const pdf = await getDocumentProxy(uint8Array);
  const { text } = await extractText(pdf, { mergePages: false });

  if (Array.isArray(text)) {
    return text
      .map((pageText, index) => `Page ${index + 1}:\n${pageText}`)
      .join("\n\n")
      .trim();
  }

  return String(text || "").trim();
}