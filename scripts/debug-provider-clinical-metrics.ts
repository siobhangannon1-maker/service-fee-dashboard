import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

console.log("ENV CHECK", {
  hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
});

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function textIncludesAny(value: string | null | undefined, phrases: string[]): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return phrases.some((phrase) => normalized.includes(phrase));
}

function deriveIsCancelled(row: {
  appointment_status: string | null;
  response_status: string | null;
  is_cancelled: boolean;
}) {
  if (
    textIncludesAny(row.appointment_status, ["cancelled", "canceled"]) ||
    textIncludesAny(row.response_status, ["cancelled", "canceled"])
  ) {
    return true;
  }

  return Boolean(row.is_cancelled);
}

function deriveIsFta(row: {
  appointment_status: string | null;
  arrival_status: string | null;
  response_status: string | null;
  is_cancelled: boolean;
  is_fta: boolean;
}) {
  const cancelled = deriveIsCancelled({
    appointment_status: row.appointment_status,
    response_status: row.response_status,
    is_cancelled: row.is_cancelled,
  });

  if (cancelled) return false;

  const ftaPhrases = [
    "fta",
    "failed to attend",
    "no show",
    "noshow",
    "did not attend",
    "dna",
  ];

  if (
    textIncludesAny(row.appointment_status, ftaPhrases) ||
    textIncludesAny(row.arrival_status, ftaPhrases) ||
    textIncludesAny(row.response_status, ftaPhrases)
  ) {
    return true;
  }

  return Boolean(row.is_fta);
}

function deriveHasFollowingAppointment(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);

  if (!normalized) return false;

  return ![
    "no",
    "n",
    "false",
    "0",
    "none",
    "no following appointment",
    "not rebooked",
    "not booked",
    "n/a",
    "na",
  ].includes(normalized);
}

function normalizeTreatmentType(input: string | null | undefined): string {
  if (!input) return "";

  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

const CONSULTATION_TREATMENT_TYPES = [
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

const CONSULTATION_TREATMENT_TYPE_SET = new Set(
  CONSULTATION_TREATMENT_TYPES.map((value) => normalizeTreatmentType(value))
);

const CONSULTATION_KEYWORDS = [
  "consult",
  "consultation",
  "cons",
  "telehealth",
  "new patient",
];

function isConsultationTreatmentType(input: string | null | undefined): boolean {
  const normalized = normalizeTreatmentType(input);

  if (!normalized) return false;

  if (CONSULTATION_TREATMENT_TYPE_SET.has(normalized)) {
    return true;
  }

  for (const known of CONSULTATION_TREATMENT_TYPE_SET) {
    if (normalized.includes(known) || known.includes(normalized)) {
      return true;
    }
  }

  for (const keyword of CONSULTATION_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return true;
    }
  }

  return false;
}

function getAppointmentKey(row: {
  provider_id: string | null;
  appointment_date: string;
  appointment_start: string;
  appointment_end: string;
  treatment_type: string | null;
}) {
  return [
    row.provider_id ?? "",
    row.appointment_date,
    row.appointment_start,
    row.appointment_end,
    (row.treatment_type ?? "").trim().toLowerCase(),
  ].join("|");
}

function dedupeAppointments<T extends {
  provider_id: string | null;
  appointment_date: string;
  appointment_start: string;
  appointment_end: string;
  treatment_type: string | null;
  appointment_status: string | null;
  response_status: string | null;
  arrival_status: string | null;
  is_cancelled: boolean;
  is_fta: boolean;
}>(rows: T[]): T[] {
  const uniqueMap = new Map<string, T>();

  for (const row of rows) {
    const key = getAppointmentKey(row);
    const existing = uniqueMap.get(key);

    if (!existing) {
      uniqueMap.set(key, row);
      continue;
    }

    const existingCancelled = deriveIsCancelled(existing);
    const rowCancelled = deriveIsCancelled(row);

    if (existingCancelled && !rowCancelled) {
      uniqueMap.set(key, row);
      continue;
    }

    const existingFta = deriveIsFta(existing);
    const rowFta = deriveIsFta(row);

    if (existingFta && !rowFta) {
      uniqueMap.set(key, row);
    }
  }

  return Array.from(uniqueMap.values());
}

async function main() {
  const providerName = process.argv[2];
  const monthKey = process.argv[3];

  if (!providerName || !monthKey) {
    throw new Error('Usage: npx tsx scripts/debug-provider-clinical-metrics.ts "Provider Name" YYYY-MM');
  }

  const monthMatch = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) {
    throw new Error('Month must be in YYYY-MM format');
  }

  const start = `${monthMatch[1]}-${monthMatch[2]}-01`;
  const endDate = new Date(Number(monthMatch[1]), Number(monthMatch[2]), 0);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

  const supabase = getServiceRoleSupabaseClient();

  const normalizedProviderName = providerName.trim().toLowerCase();

  const { data: mappings, error: mappingsError } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
    .eq("source_type", "appointments_csv");

  if (mappingsError) {
    throw new Error(`Failed to load provider mappings: ${mappingsError.message}`);
  }

  const mapping = (mappings ?? []).find(
    (row: any) => row.normalized_provider_name === normalizedProviderName
  );

  if (!mapping?.provider_id) {
    console.log("No provider mapping found for:", providerName);
    console.log("Available mappings:");
    for (const row of (mappings ?? []).slice(0, 50)) {
      console.log(`- ${row.raw_provider_name} -> ${row.provider_id}`);
    }
    return;
  }

  const providerId = mapping.provider_id;

  const { data: rows, error: rowsError } = await supabase
    .from("provider_appointments_raw")
    .select(`
      id,
      provider_id,
      provider_name_raw,
      appointment_date,
      appointment_start,
      appointment_end,
      duration_minutes,
      patient_name_raw,
      treatment_type,
      appointment_status,
      arrival_status,
      response_status,
      following_appointment_raw,
      has_following_appointment,
      is_cancelled,
      is_fta
    `)
    .eq("provider_id", providerId)
    .gte("appointment_date", start)
    .lte("appointment_date", end)
    .order("appointment_date", { ascending: true })
    .order("appointment_start", { ascending: true });

  if (rowsError) {
    throw new Error(`Failed to load appointment rows: ${rowsError.message}`);
  }

  const rawRows = rows ?? [];
  const dedupedRows = dedupeAppointments(rawRows as any[]);

  console.log("");
  console.log("========================================");
  console.log("PROVIDER CLINICAL DEBUG");
  console.log("========================================");
  console.log("Provider:", providerName);
  console.log("Provider ID:", providerId);
  console.log("Month:", monthKey);
  console.log("Date range:", start, "to", end);
  console.log("Raw row count:", rawRows.length);
  console.log("Deduped row count:", dedupedRows.length);
  console.log("");

  const debugRows = dedupedRows.map((row: any) => {
    const derivedCancelled = deriveIsCancelled(row);
    const derivedFta = deriveIsFta(row);
    const consultation = isConsultationTreatmentType(row.treatment_type);
    const following = deriveHasFollowingAppointment(row.following_appointment_raw);

    return {
      appointment_date: row.appointment_date,
      appointment_start: row.appointment_start,
      patient_name_raw: row.patient_name_raw,
      treatment_type: row.treatment_type,
      appointment_status: row.appointment_status,
      arrival_status: row.arrival_status,
      response_status: row.response_status,
      following_appointment_raw: row.following_appointment_raw,
      stored_has_following_appointment: row.has_following_appointment,
      derived_has_following_appointment: following,
      stored_is_cancelled: row.is_cancelled,
      derived_is_cancelled: derivedCancelled,
      stored_is_fta: row.is_fta,
      derived_is_fta: derivedFta,
      is_consultation: consultation,
      counts_in_total_appointments: true,
      counts_in_completed_consults: !derivedCancelled && !derivedFta && consultation,
    };
  });

  for (const row of debugRows) {
    console.log(JSON.stringify(row, null, 2));
  }

  const totalAppointments = debugRows.length;
  const cancelledNoRebook = debugRows.filter(
    (row) => row.derived_is_cancelled && !row.derived_has_following_appointment
  ).length;
  const ftaCount = debugRows.filter((row) => row.derived_is_fta).length;
  const completedConsults = debugRows.filter((row) => row.counts_in_completed_consults);
  const consultRebooked = completedConsults.filter(
    (row) => row.derived_has_following_appointment
  ).length;
  const consultNotRebooked = completedConsults.filter(
    (row) => !row.derived_has_following_appointment
  ).length;

  console.log("");
  console.log("========================================");
  console.log("SUMMARY");
  console.log("========================================");
  console.log("totalAppointments =", totalAppointments);
  console.log("cancelledNoRebook =", cancelledNoRebook);
  console.log("ftaCount =", ftaCount);
  console.log("consultCompletedCount =", completedConsults.length);
  console.log("consultRebookedCount =", consultRebooked);
  console.log("consultNotRebookedCount =", consultNotRebooked);
  console.log(
    "consultRebookingRate =",
    completedConsults.length > 0 ? consultRebooked / completedConsults.length : 0
  );
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});