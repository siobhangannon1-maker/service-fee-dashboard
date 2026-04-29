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

async function syncUsers(supabase: any) {
  const data = await connecteamFetch("/users/v1/users?limit=100&offset=0");

  const users = data?.data?.users || [];

  const rows = users.map((user: any) => ({
    connecteam_user_id: String(user.userId),
    display_name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    first_name: user.firstName || null,
    last_name: user.lastName || null,
    email: user.email || null,
    phone: user.phoneNumber || null,
    raw_json: user,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("connecteam_users").upsert(rows, {
      onConflict: "connecteam_user_id",
    });

    if (error) throw error;
  }

  return rows.length;
}

async function syncTimesheets(supabase: any, from: string, to: string) {
  const timeClockId = getConnecteamTimeClockId();

  const data = await connecteamFetch(
    `/time-clock/v1/time-clocks/${timeClockId}/timesheet?startDate=${from}&endDate=${to}`
  );

  const users = data?.data?.users || [];
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

      const totalMinutes = getTotalMinutes(record);

      rows.push({
        connecteam_user_id: connecteamUserId,
        work_date: workDate,
        regular_minutes: totalMinutes,
        overtime_minutes: 0,
        estimated_overtime_minutes: 0,
        total_minutes: totalMinutes,
        break_minutes: 0,
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

  if (rows.length > 0) {
    const { error } = await supabase
      .from("connecteam_daily_timesheets")
      .upsert(rows, {
        onConflict: "connecteam_user_id,work_date",
      });

    if (error) throw error;
  }

  return rows.length;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const today = new Date().toISOString().slice(0, 10);

    const from = url.searchParams.get("from") || today;
    const to = url.searchParams.get("to") || today;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const userCount = await syncUsers(supabase);
    const timesheetCount = await syncTimesheets(supabase, from, to);

    return NextResponse.json({
      message: "Connecteam sync completed",
      from,
      to,
      usersSynced: userCount,
      timesheetRowsSynced: timesheetCount,
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