export const DEFAULT_PDF_BODY_FONT_SIZE = 10;
export const PDF_BODY_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16] as const;
export function pdfBodyFontSize(value: unknown): number {
  const size = Number(value);
  return Number.isInteger(size) && size >= 10 && size <= 16 ? size : DEFAULT_PDF_BODY_FONT_SIZE;
}
export function extractPdfBodyFontSize(text: string): number {
  return pdfBodyFontSize(String(text || '').match(/\[\[PDF_FONT_SIZE:([^\]]*)\]\]/)?.[1]);
}
export function stripPdfFontSize(text: string): string {
  return String(text || '').replace(/\[\[PDF_FONT_SIZE:[\s\S]*?\]\]/g, '');
}
