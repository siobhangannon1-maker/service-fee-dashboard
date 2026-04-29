import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const DAILY_STANDARD_HOURS = 9.5;
const WEEKLY_STANDARD_HOURS = 38;
const FIXED_BREAK_MINUTES = 30;

function formatHours(minutes: number) {
  return (minutes / 60).toFixed(2);
}

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}

function getReason(diff: number, daily: number, weekly: number) {
  const threshold = 0.5 * 60;

  if (Math.abs(diff) < threshold) return "Matched";

  if (diff > 0) {
    if (weekly > daily) return "Underpaid (weekly OT not applied)";
    return "Underpaid (missed long shifts)";
  }

  if (diff < 0) {
    if (weekly > 0) return "Overpaid (penalty or weekly rule)";
    return "Overpaid (likely penalties)";
  }

  return "Check data";
}

export default async function Page({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const from = searchParams.from || "2026-04-01";
  const to = searchParams.to || "2026-04-17";

  const { data: timesheets } = await supabase
    .from("connecteam_daily_timesheets")
    .select("connecteam_user_id, work_date, total_minutes")
    .gte("work_date", from)
    .lte("work_date", to);

  const { data: users } = await supabase
    .from("connecteam_users")
    .select("connecteam_user_id, display_name");

  const { data: wageLines } = await supabase
    .from("staff_wage_lines")
    .select("employee_name, hours, line_type");

  const userMap: Record<string, string> = {};
  (users || []).forEach((u: any) => {
    userMap[String(u.connecteam_user_id)] =
      u.display_name || String(u.connecteam_user_id);
  });

  const dailyOT: Record<string, number> = {};
  const weeklyMap: Record<string, number> = {};

  (timesheets || []).forEach((row: any) => {
    const staff =
      userMap[String(row.connecteam_user_id)] ||
      row.connecteam_user_id;

    const totalMinutes = Number(row.total_minutes || 0);
    const paidMinutes = Math.max(totalMinutes - FIXED_BREAK_MINUTES, 0);

    const daily = Math.max(paidMinutes - DAILY_STANDARD_HOURS * 60, 0);
    dailyOT[staff] = (dailyOT[staff] || 0) + daily;

    const week = getWeekStart(row.work_date);
    const key = `${staff}__${week}`;
    weeklyMap[key] = (weeklyMap[key] || 0) + paidMinutes;
  });

  const weeklyOT: Record<string, number> = {};

  Object.entries(weeklyMap).forEach(([key, minutes]) => {
    const [staff] = key.split("__");

    const ot = Math.max(minutes - WEEKLY_STANDARD_HOURS * 60, 0);
    weeklyOT[staff] = (weeklyOT[staff] || 0) + ot;
  });

  const xeroOT: Record<string, number> = {};

  (wageLines || []).forEach((row: any) => {
    if (row.line_type === "overtime") {
      xeroOT[row.employee_name] =
        (xeroOT[row.employee_name] || 0) + Number(row.hours) * 60;
    }
  });

  const allStaff = new Set([
    ...Object.keys(dailyOT),
    ...Object.keys(weeklyOT),
    ...Object.keys(xeroOT),
  ]);

  const rows = Array.from(allStaff).map((staff) => {
    const daily = dailyOT[staff] || 0;
    const weekly = weeklyOT[staff] || 0;
    const expected = daily + weekly;
    const paid = xeroOT[staff] || 0;

    const diff = expected - paid;

    return {
      staff,
      expected,
      paid,
      diff,
      reason: getReason(diff, daily, weekly),
    };
  });

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Overtime Reconciliation
      </h1>

      <table style={{ width: "100%", marginTop: 24 }}>
        <thead>
          <tr>
            <th style={th}>Staff</th>
            <th style={right}>Expected</th>
            <th style={right}>Xero</th>
            <th style={right}>Diff</th>
            <th style={th}>Reason</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={td}>{r.staff}</td>
              <td style={rightTd}>{formatHours(r.expected)}</td>
              <td style={rightTd}>{formatHours(r.paid)}</td>
              <td style={rightTd}>{formatHours(r.diff)}</td>
              <td style={td}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const th = { textAlign: "left", padding: 8 };
const right = { textAlign: "right", padding: 8 };
const td = { padding: 8 };
const rightTd = { padding: 8, textAlign: "right" };