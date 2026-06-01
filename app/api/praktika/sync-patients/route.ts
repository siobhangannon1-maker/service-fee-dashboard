import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalise(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get("q") || "").trim();

    if (query.length < 2) {
      return NextResponse.json({ patients: [] });
    }

    const terms = normalise(query).split(" ").filter(Boolean);
    const cleanDigits = query.replace(/\D/g, "");

    let dbQuery = supabaseAdmin
      .from("praktika_patients")
      .select(
        `
        praktika_patient_id,
        praktika_patient_number,
        first_name,
        last_name,
        preferred_name,
        dob,
        mobile,
        home_phone,
        email,
        has_high_medical_alert,
        is_bad_patient
      `
      )
      .limit(200);

    if (cleanDigits.length >= 3) {
      dbQuery = dbQuery.or(
        `mobile.ilike.%${cleanDigits}%,home_phone.ilike.%${cleanDigits}%,praktika_patient_number.ilike.%${cleanDigits}%`
      );
    } else if (terms.length === 1) {
      const term = terms[0];

      dbQuery = dbQuery.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,preferred_name.ilike.%${term}%`
      );
    } else {
      const firstTerm = terms[0];
      const lastTerm = terms[terms.length - 1];

      dbQuery = dbQuery.or(
        `first_name.ilike.%${firstTerm}%,preferred_name.ilike.%${firstTerm}%,last_name.ilike.%${lastTerm}%,first_name.ilike.%${lastTerm}%,last_name.ilike.%${firstTerm}%`
      );
    }

    const { data, error } = await dbQuery
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const filtered = (data || []).filter((patient) => {
      const first = normalise(patient.first_name);
      const preferred = normalise(patient.preferred_name);
      const last = normalise(patient.last_name);
      const fullName = normalise(`${patient.first_name || ""} ${patient.last_name || ""}`);
      const preferredFullName = normalise(`${patient.preferred_name || ""} ${patient.last_name || ""}`);
      const reverseName = normalise(`${patient.last_name || ""} ${patient.first_name || ""}`);

      if (cleanDigits.length >= 3) return true;

      return terms.every(
        (term) =>
          first.includes(term) ||
          preferred.includes(term) ||
          last.includes(term) ||
          fullName.includes(term) ||
          preferredFullName.includes(term) ||
          reverseName.includes(term)
      );
    });

    const patients = filtered.slice(0, 25).map((patient) => ({
      id: Number(patient.praktika_patient_id),
      firstName: patient.first_name,
      lastName: patient.last_name,
      preferredName: patient.preferred_name,
      dob: patient.dob,
      mobile: patient.mobile,
      homePhone: patient.home_phone,
      email: patient.email,
      patientNumber: patient.praktika_patient_number
        ? Number(patient.praktika_patient_number)
        : null,
      hasHighMedicalAlert: Boolean(patient.has_high_medical_alert),
      isBadPatient: Boolean(patient.is_bad_patient),
    }));

    return NextResponse.json({
      patients,
      debug: {
        source: "local_praktika_patients_cache",
        query,
        count: patients.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Patient search failed.",
      },
      { status: 500 }
    );
  }
}