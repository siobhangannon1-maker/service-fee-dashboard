import { NextRequest, NextResponse } from "next/server";
import { praktikaPost } from "@/lib/praktika/praktika-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

type PraktikaAppointmentRow = any;

function seconds(start: number) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

function matchRule(value: string, matchType: string, matchValue: string) {
  const v = value.toLowerCase();
  const m = matchValue.toLowerCase();

  if (matchType === "equals") return v === m;
  if (matchType === "starts_with") return v.startsWith(m);
  return v.includes(m);
}

function resolveLocationFromRules(row: PraktikaAppointmentRow, rules: any[]) {
  for (const rule of rules) {
    let value = "";

    if (rule.match_field === "tx_type") value = row.vchTxType || "";
    if (rule.match_field === "tx_label") value = row.vchTxLabel || "";
    if (rule.match_field === "appointment_notes") value = row.vchAppointmentNotes || "";
    if (rule.match_field === "resource_name") value = row.vchResourceName || "";
    if (rule.match_field === "provider_name") value = row.vchProviderName || "";

    if (matchRule(value, rule.match_type, rule.match_value)) {
      return {
        locationName: rule.location_name,
        ruleId: rule.id,
      };
    }
  }

  return {
    locationName: "Focus Dental Specialists",
    ruleId: null,
  };
}

export async function POST(request: NextRequest) {
  const start = Date.now();

  try {
    console.log("SYNC APPOINTMENTS BULK: started");

    const { fromDate, toDate } = await request.json();

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required." },
        { status: 400 }
      );
    }

    const rows = await praktikaPost<PraktikaAppointmentRow[]>({
      path: "/php/json/db_reportingDataWarehouse.php",
      contentType: "form",
      referer:
        "https://praktika.praktika.net.au/v2/reports/upcoming-appointments",
      body: {
        sReportName: "appointments",
        bByCreationTime: "false",
        "iPracticeIds[]": ["1181"],
        sFromDate: fromDate,
        sToDate: toDate,
      },
    });

    console.log(
      "SYNC APPOINTMENTS BULK: Praktika returned",
      rows?.length || 0,
      "rows after",
      seconds(start)
    );

    const { data: rules, error: rulesError } = await supabaseAdmin
      .from("praktika_location_rules")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (rulesError) {
      throw new Error(`Could not load location rules: ${rulesError.message}`);
    }

    const now = new Date().toISOString();

    const patientMap = new Map<string, any>();

for (const row of rows || []) {
  patientMap.set(String(row.iPatientId), {
    praktika_patient_id: String(row.iPatientId),
    praktika_patient_number: row.iPatientNumber || null,
    practice_id: row.iPractice || "1181",
    first_name: row.vchPatientFirstName || null,
    last_name: row.vchPatientLastName || null,
    mobile: row.vchMobile || null,
    email: row.vchEmail || null,
    synced_at: now,
    updated_at: now,
    raw_json: row,
  });
}

const patientRows = Array.from(patientMap.values());

    const appointmentRows = (rows || []).map((row) => {
      const location = resolveLocationFromRules(row, rules || []);

      return {
        praktika_appointment_id: String(row.iAppointmentId),
        praktika_patient_id: String(row.iPatientId),
        praktika_patient_number: row.iPatientNumber || null,
        practice_id: row.iPractice || "1181",

        appointment_datetime: row.dtAppointment
          ? new Date(row.dtAppointment).toISOString()
          : null,
        appointment_date: row.vchAppDate || null,
        appointment_day: row.vchAppWeekDay || null,
        appointment_time: row.vchAppTime || null,
        appointment_length: row.vchAppLength || null,

        tx_type: row.vchTxType || null,
        tx_label: row.vchTxLabel || null,
        provider_name: row.vchProviderName || null,
        provider_initials: row.vchProviderInitials || null,
        resource_name: row.vchResourceName || null,

        mapped_location: location.locationName,
        location_rule_id: location.ruleId,

        sms_status: row.iSMSStatus || null,
        appointment_status_id: row.iAppointmentStatusId || null,
        patient_response_id: row.iPatientResponseId || null,
        arrival_status_id: row.iPatientArrivalStatusId || null,

        patient_first_name: row.vchPatientFirstName || null,
        patient_last_name: row.vchPatientLastName || null,
        patient_mobile: row.vchMobile || null,
        patient_email: row.vchEmail || null,

        appointment_notes: row.vchAppointmentNotes || null,

        following_appointment_datetime: row.dtFollowingAppDate
          ? new Date(row.dtFollowingAppDate).toISOString()
          : null,
        following_appointment_tx_label: row.vchFollowingAppTxLabel || null,
        following_appointment_tx_type: row.vchFollowingAppTxType || null,

        raw_json: row,
        synced_at: now,
        updated_at: now,
      };
    });

    console.log("SYNC APPOINTMENTS BULK: upserting patients", patientRows.length);

    const patientResult = await supabaseAdmin
      .from("praktika_patients")
      .upsert(patientRows, { onConflict: "praktika_patient_id" });

    if (patientResult.error) {
      throw new Error(`Patient bulk upsert failed: ${patientResult.error.message}`);
    }

    console.log(
      "SYNC APPOINTMENTS BULK: upserting appointments",
      appointmentRows.length
    );

    const appointmentResult = await supabaseAdmin
      .from("praktika_appointments")
      .upsert(appointmentRows, { onConflict: "praktika_appointment_id" });

    if (appointmentResult.error) {
      throw new Error(
        `Appointment bulk upsert failed: ${appointmentResult.error.message}`
      );
    }

    console.log("SYNC APPOINTMENTS BULK: finished", seconds(start));

    return NextResponse.json({
      ok: true,
      syncedCount: appointmentRows.length,
      debug: {
        fromDate,
        toDate,
        returnedFromPraktika: rows?.length || 0,
        patientUpsertCount: patientRows.length,
        appointmentUpsertCount: appointmentRows.length,
        totalTime: seconds(start),
      },
    });
  } catch (error) {
    console.error("SYNC APPOINTMENTS BULK: failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Appointment sync failed.",
        debug: {
          totalTime: seconds(start),
        },
      },
      { status: 500 }
    );
  }
}