export const CONSULTATION_TREATMENT_TYPES = [
  "Consultation Coorparoo",
  "Consultation Paddington",
  "Consultation Chermside",
  "Consultation Capalaba",
  "IMPLANT CONS",
  "Consult 30 mins Orthognathic",
  "Telehealth",
  "Coorparoo Third Molar",
  "Senior Consult 70+",
  "ORAL PATH CONSULTATION",
  "Online Booking Periodontist Consultation",
  "Online Booking Coorparoo",
  "CAPALABA 10min consultation",
  "CAPALABA 20min consultation",
  "Paddington Third Molars",
  "OB ORTHOGNATHIC CONS",
] as const;

export function normalizeTreatmentType(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CONSULTATION_TREATMENT_TYPE_SET = new Set(
  CONSULTATION_TREATMENT_TYPES.map((value) => normalizeTreatmentType(value))
);

// 👇 NEW: keywords for fallback matching
const CONSULTATION_KEYWORDS = [
  "consult",
  "consultation",
  "cons",
  "telehealth",
  "exam",
  "new patient",
];

export function isConsultationTreatmentType(input: string | null | undefined): boolean {
  const normalized = normalizeTreatmentType(input);

  if (!normalized) return false;

  // ✅ 1. Exact match (your original logic)
  if (CONSULTATION_TREATMENT_TYPE_SET.has(normalized)) {
    return true;
  }

  // ✅ 2. Partial match against your list
  for (const known of CONSULTATION_TREATMENT_TYPE_SET) {
    if (normalized.includes(known) || known.includes(normalized)) {
      return true;
    }
  }

  // ✅ 3. Keyword fallback (this is the key fix)
  for (const keyword of CONSULTATION_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return true;
    }
  }

  return false;
}