import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function num(value: any) {
  if (value === null || value === undefined || value === "") return 0;
  return Number(value);
}

export async function POST(request: NextRequest) {
  try {
    const { fromDate, toDate } = await request.json();

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID;

    if (!practiceId) {
      return NextResponse.json(
        { error: "Missing PRAKTIKA_PRACTICE_ID" },
        { status: 500 }
      );
    }

    const formData = new URLSearchParams();
    formData.append("sReportName", "providerPerformance");
    formData.append("bExcludeLunchFromWorkingHours", "true");
    formData.append("iPracticeIds[]", practiceId);
    formData.append("sFromDate", fromDate);
    formData.append("sToDate", toDate);
    formData.append("sWorkingHoursMethod", "dumb");

    const data = await fetchPraktikaJson(
      formData,
      "https://praktika.praktika.net.au/v2/reports/provider-performance"
    );

    const rows = data.map((row: any) => ({
      report_date: fromDate,
      practice_id: Number(row.iPracticeId),
      provider_id: Number(row.iProviderId),
      provider_name: row.vchProviderName,

      total_patients: num(row.iTotalPatients),
      days_total: num(row.iDaysTotal),
      days_worked: num(row.iDaysWorked),

      patients_per_day: num(row.nPatientsPerDay),
      billed_hours: num(row.nBilledHours),
      scheduled_hours: num(row.nScheduledHours),
      appointed_hours: num(row.nAppointedHours),

      scheduled_fees: num(row.nScheduledFees),
      actual_fees: num(row.nActualFees),
      fee_discounts: num(row.nFeeDiscounts),
      adjustments: num(row.nAdjustments),
      billed_amount: num(row.nBilledAmount),

      rate_per_scheduled_hour: num(row.nRatePerScheduledHour),
      rate_per_billed_hour: num(row.nRatePerBilledHour),
      rate_per_day: num(row.nRatePerDay),

      total_appointments: num(row.iTotalAppointments),
      appointments_per_patient: num(row.nAppointmentsPerPatient),
      rate_per_appointment: num(row.nRatePerAppointment),

      new_patients: num(row.iNewPatients),
      total_ftas: num(row.iTotalFTAs),
      total_cancellations: num(row.iTotalCancellations),

      revenue_per_patient: num(row.nRevenuePerPatient),
      rebooking_percent: num(row.nRebookingPercent),
    }));

    const { error } = await supabase
      .from("praktika_provider_performance")
      .upsert(rows, {
        onConflict: "report_date,provider_id",
      });

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      rowsInserted: rows.length,
      data: rows,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Failed to sync Provider Performance" },
      { status: 500 }
    );
  }
}