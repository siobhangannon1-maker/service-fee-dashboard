import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";

const STANDARD_DAILY_HOURS = 9.5;
const FIXED_BREAK_MINUTES = 30;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    await requireRole(["admin", "practice_manager"]);

    const supabase = getSupabase();
    const url = new URL(request.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      return NextResponse.json(
        { success: false, error: "Missing from/to dates." },
        { status: 400 }
      );
    }

    // LOAD TIMESHEETS
    const { data: timesheetRows, error: timesheetError } = await supabase
      .from("connecteam_daily_timesheets")
      .select("connecteam_user_id, work_date, total_minutes")
      .gte("work_date", from)
      .lte("work_date", to);

    if (timesheetError) throw new Error(timesheetError.message);

    // LOAD MAPPINGS
    const { data: mappingsData } = await supabase
      .from("employee_mapping")
      .select(
        "connecteam_user_id, connecteam_user_name, xero_employee_name"
      )
      .eq("is_active", true);

    // BUILD MAP
    const staffNameById = new Map<string, string>();

    for (const m of mappingsData ?? []) {
      if (m.connecteam_user_id) {
        staffNameById.set(
          String(m.connecteam_user_id).trim(),
          m.connecteam_user_name ||
            m.xero_employee_name ||
            "Unmapped"
        );
      }
    }

    // AGGREGATE
    const byDay = new Map<string, any>();
    const byStaff = new Map<string, any>();

    for (const row of timesheetRows ?? []) {
      const userId = String(row.connecteam_user_id).trim();
      const date = String(row.work_date);

      const totalMinutes = Number(row.total_minutes ?? 0);
      const paidMinutes = Math.max(totalMinutes - FIXED_BREAK_MINUTES, 0);
      const overtimeMinutes = Math.max(
        paidMinutes - STANDARD_DAILY_HOURS * 60,
        0
      );

      const totalHours = totalMinutes / 60;
      const overtimeHours = overtimeMinutes / 60;

      // DAY
      const day = byDay.get(date) ?? {
        date,
        total_hours: 0,
        overtime_hours: 0,
      };

      day.total_hours += totalHours;
      day.overtime_hours += overtimeHours;
      byDay.set(date, day);

      // STAFF
      let staff = byStaff.get(userId);

      if (!staff) {
        staff = {
          user_id: userId,
          staff_name: staffNameById.get(userId) || "Unmapped",
          total_hours: 0,
          overtime_hours: 0,
          long_days: 0,
        };
      }

      staff.total_hours += totalHours;
      staff.overtime_hours += overtimeHours;

      if (overtimeHours > 0) {
        staff.long_days += 1;
      }

      byStaff.set(userId, staff);
    }

    return NextResponse.json({
      success: true,
      from,
      to,
      days: Array.from(byDay.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
      staff: Array.from(byStaff.values()).sort(
        (a, b) => b.overtime_hours - a.overtime_hours
      ),
    });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}