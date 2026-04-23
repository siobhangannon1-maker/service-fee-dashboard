export function normalizeProviderName(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

export function normalizeProviderNameForDisplay(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

export function createBaseProviderName(input: string | null | undefined): string {
  if (!input) return "";

  return normalizeProviderName(input)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}