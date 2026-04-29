import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";

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
      return NextResponse.json({ error: "Missing dates" }, { status: 400 });
    }

    // 1. Connecteam overtime hours
    const { data: ct } = await supabase
      .from("connecteam_daily_timesheets")
      .select("connecteam_user_id, work_date, total_minutes")
      .gte("work_date", from)
      .lte("work_date", to);

    // 2. Mapping
    const { data: map } = await supabase
      .from("employee_mapping")
      .select("connecteam_user_id, xero_employee_name")
      .eq("is_active", true);

    const mapById = new Map<string, string>();
    for (const m of map ?? []) {
      mapById.set(String(m.connecteam_user_id), m.xero_employee_name);
    }

    // 3. Xero overtime $
    const { data: xero } = await supabase
      .from("staff_wage_lines")
      .select("employee_name, amount, hours")
      .eq("line_type", "overtime");

    const rateByEmployee = new Map<string, number>();
    for (const row of xero ?? []) {
      if (row.hours > 0) {
        rateByEmployee.set(
          row.employee_name,
          row.amount / row.hours
        );
      }
    }

    // 4. Combine
    const result: any = {};

    for (const row of ct ?? []) {
      const id = String(row.connecteam_user_id);
      const name = mapById.get(id) || "Unmapped";

      const hours = (row.total_minutes || 0) / 60;
      const overtime = Math.max(hours - 9.5, 0);

      const rate = rateByEmployee.get(name) || 0;
      const cost = overtime * rate;

      if (!result[name]) {
        result[name] = {
          staff_name: name,
          overtime_hours: 0,
          overtime_cost: 0,
        };
      }

      result[name].overtime_hours += overtime;
      result[name].overtime_cost += cost;
    }

    return NextResponse.json({
      staff: Object.values(result).sort(
        (a: any, b: any) => b.overtime_cost - a.overtime_cost
      ),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}