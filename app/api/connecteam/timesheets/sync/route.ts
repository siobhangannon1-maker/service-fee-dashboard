import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  connecteamFetch,
  getConnecteamTimeClockId,
} from "@/lib/connecteam";

function getNumber(value: any): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function hoursToMinutes(hours: any): number {
  return Math.round(getNumber(hours) * 60);
}

function getOfficialOvertimeMinutes(payItems: any[]): number {
  if (!Array.isArray(payItems)) return 0;

  return payItems.reduce((total, item) => {
    const payRuleType = String(item?.payRule?.type || "").toLowerCase();
    const payRuleCode = String(item?.payRule?.code || "").toLowerCase();

    const isOvertime =
      payRuleType.includes("overtime") ||
      payRuleCode.includes("overtime") ||
      payRuleCode.includes("ot") ||
      payRuleCode.includes("1.5") ||
      payRuleCode.includes("2.0") ||
      payRuleCode.includes("double");

    if (!isOvertime) return total;

    return total + hoursToMinutes(item.hours || 0);
  }, 0);
}

function getDateFromRecord(record: any): string | null {
  return record.date || record.workDate || record.day || record.startDate || null;
}

function getTotalMinutes(record: any): number {
  return hoursToMinutes(
    record.dailyTotalWorkHours ||
      record.dailyTotalHours ||
      record.totalWorkHours ||
      record.totalHours ||
      record.workHours ||
      0
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      return NextResponse.json(
        {
          error: "Missing date range. Use ?from=YYYY-MM-DD&to=YYYY-MM-DD",
          example:
            "/api/connecteam/timesheets/sync?from=2026-04-01&to=2026-04-26",
        },
        { status: 400 }
      );
    }

    const standardDailyHours = getNumber(
      process.env.CONNECTEAM_STANDARD_DAILY_HOURS || 9.5
    );

    const standardDailyMinutes = standardDailyHours * 60;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const timeClockId = getConnecteamTimeClockId();

    const data = await connecteamFetch(
      `/time-clock/v1/time-clocks/${timeClockId}/timesheet?startDate=${from}&endDate=${to}`
    );

    const users = data?.data?.users || [];

    if (!users.length) {
      return NextResponse.json({
        message: "No timesheet users returned from Connecteam",
        raw: data,
      });
    }

    const rows: any[] = [];

    for (const user of users) {
      const connecteamUserId = String(user.userId);

      const dailyRecords =
        user.dailyRecords ||
        user.daily_records ||
        user.records ||
        [];

      for (const record of dailyRecords) {
        const workDate = getDateFromRecord(record);

        if (!workDate) continue;

        const payItems = record.payItems || [];

        const totalMinutes = getTotalMinutes(record);

        const officialOvertimeMinutes =
          getOfficialOvertimeMinutes(payItems);

        const estimatedOvertimeMinutes = Math.max(
          totalMinutes - standardDailyMinutes,
          0
        );

        const breakMinutes = hoursToMinutes(
          record.dailyTotalUnpaidBreakHours ||
            record.unpaidBreakHours ||
            record.breakHours ||
            0
        );

        rows.push({
          connecteam_user_id: connecteamUserId,
          work_date: workDate,

          regular_minutes: Math.max(
            totalMinutes - estimatedOvertimeMinutes,
            0
          ),

          overtime_minutes: officialOvertimeMinutes,
          estimated_overtime_minutes: estimatedOvertimeMinutes,
          total_minutes: totalMinutes,
          break_minutes: breakMinutes,

          approval_status:
            record.isApproved === true
              ? "approved"
              : record.isApproved === false
              ? "not_approved"
              : null,

          raw_json: record,
          synced_at: new Date().toISOString(),
        });
      }
    }

    if (!rows.length) {
      return NextResponse.json({
        message: "No daily records found",
        raw: data,
      });
    }

    const { error } = await supabase
      .from("connecteam_daily_timesheets")
      .upsert(rows, {
        onConflict: "connecteam_user_id,work_date",
      });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      message: "Connecteam daily timesheets synced successfully",
      from,
      to,
      standardDailyHours,
      usersFound: users.length,
      dailyRowsSaved: rows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
      },
      { status: 500 }
    );
  }
}