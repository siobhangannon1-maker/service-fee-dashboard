import { supabaseAdmin } from "@/lib/supabase/admin";

function normalise(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function namesAreSimilar(a: string, b: string) {
  const nameA = normalise(a);
  const nameB = normalise(b);

  if (!nameA || !nameB) return false;

  return nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA);
}

function dobMatches(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return normalise(a) === normalise(b);
}

export async function matchPatient({
  patientName,
  patientDob,
}: {
  patientName: string | null;
  patientDob: string | null;
}) {
  if (!patientName) {
    return {
      matchedPatientId: null,
      matchStatus: "no_patient_name",
      matchConfidence: 0,
    };
  }

  const { data: patients, error } = await supabaseAdmin
    .from("ai_patients")
    .select("*")
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  const exactDobMatch = patients?.find(
    (patient) =>
      namesAreSimilar(patient.full_name, patientName) &&
      dobMatches(patient.date_of_birth, patientDob)
  );

  if (exactDobMatch) {
    return {
      matchedPatientId: exactDobMatch.id,
      matchStatus: "matched",
      matchConfidence: 0.98,
    };
  }

  const nameOnlyMatch = patients?.find((patient) =>
    namesAreSimilar(patient.full_name, patientName)
  );

  if (nameOnlyMatch) {
    return {
      matchedPatientId: nameOnlyMatch.id,
      matchStatus: "possible_match",
      matchConfidence: 0.7,
    };
  }

  return {
    matchedPatientId: null,
    matchStatus: "no_match",
    matchConfidence: 0,
  };
}