export const APPOINTMENT_CATEGORY_GROUPS: Record<string, string[]> = {
  "IV Sedation": [
    "IV COORPAROO",
    "IV PADDINGTON",
  ],

  GA: [
    "The Wesley",
    "Brisbane Private",
    "North West Private",
    "Sunnybank Private Hospital",
    "South Brisbane Day Hospital",
    "Greenslopes Private Hospital",
    "Chermside Day Hospital",
    "Herston Private Hospital",
    "Westside Private Hospital",
    "St Andrews War Memorial Hospital",
    "St Andrews Day Surgery Centre",
    "Orthognathic Surgery",
  ],

  Consultation: [
    "Consultation Coorparoo",
    "Consultation Coorparoo Perio/Implant",
    "Consultation Paddington",
    "Consultation Capalaba",
    "Consultation Chermside",
    "Consult 30mins Orthognathic",
    "Telehealth",
    "COORPAROO Third Molar",
    "PADDINGTON Third Molars",
    "SENIOR CONSULT (70 +)",
    "IMPLANT CONS",
    "Online Booking Periodontist Consultation",
    "Online Booking Coorparoo",
    "CAPALABA 10min consultation",
    "CAPALABA 20min consultation",
    "ORAL PATH CONSULTATION",
  ],

  Review: [
    "TELEHEALTH 10min/phone review",
    "COORPAROO 10min consultation/review",
    "PHONE REVIEW",
    "TELEREVIEW",
    "REVIEW",
  ],

  SPT: [
    "Maintenance",
  ],

  "Perio Surgery": [
    "Periodontal Surgery",
    "Grafting Surgery",
  ],

  "Implant Surgery": [
    "Implant Surgery",
  ],

  Extraction: [
    "Extraction",
  ],

  Debridement: [
    "Debridement",
    "40/80 DEB",
    "60 DEB",
  ],

  "Post Op": [
    "PERIO POSTOP",
    "POST OP",
  ],

  Biopsy: [
    "BIOPSY",
  ],
};

export function normaliseAppointmentType(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export const APPOINTMENT_CATEGORY_MAP: Record<string, string> = Object.entries(
  APPOINTMENT_CATEGORY_GROUPS
).reduce((acc, [category, appointmentTypes]) => {
  for (const appointmentType of appointmentTypes) {
    acc[normaliseAppointmentType(appointmentType)] = category;
  }

  return acc;
}, {} as Record<string, string>);

export function getAppointmentCategory(txType: string | null | undefined) {
  const normalisedTxType = normaliseAppointmentType(txType);
  return APPOINTMENT_CATEGORY_MAP[normalisedTxType] || "Unmapped";
}