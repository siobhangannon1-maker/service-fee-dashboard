import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const WEEKLY_STANDARD_HOURS = 38;
const FIXED_BREAK_MINUTES = 30;

function formatHours(minutes: number) {
  return (minutes / 60).toFixed(2);
}

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
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

  const userMap: Record<string, string> = {};
  (users || []).forEach((u: any) => {
    userMap[String(u.connecteam_user_id)] =
      u.display_name || String(u.connecteam_user_id);
  });

  // Group by staff + week
  const weeklyMap: Record<string, number> = {};

  (timesheets || []).forEach((row: any) => {
    const staffId = String(row.connecteam_user_id);
    const staffName = userMap[staffId] || staffId;

    const weekStart = getWeekStart(row.work_date);

    const totalMinutes = Number(row.total_minutes || 0);
    const paidMinutes = Math.max(totalMinutes - FIXED_BREAK_MINUTES, 0);

    const key = `${staffName}__${weekStart}`;

    weeklyMap[key] = (weeklyMap[key] || 0) + paidMinutes;
  });

  const rows = Object.entries(weeklyMap).map(([key, minutes]) => {
    const [staff, weekStart] = key.split("__");

    const overtimeMinutes = Math.max(
      minutes - WEEKLY_STANDARD_HOURS * 60,
      0
    );

    return {
      staff,
      weekStart,
      totalMinutes: minutes,
      overtimeMinutes,
    };
  });

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Weekly Overtime
      </h1>

      <p style={{ marginTop: 8 }}>
        Weekly overtime calculated above {WEEKLY_STANDARD_HOURS} hours
      </p>

      <table
        style={{
          width: "100%",
          marginTop: 24,
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            <th style={th}>Staff</th>
            <th style={th}>Week Starting</th>
            <th style={right}>Total Hours</th>
            <th style={right}>Weekly OT</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={td}>{r.staff}</td>
              <td style={td}>{r.weekStart}</td>
              <td style={rightTd}>{formatHours(r.totalMinutes)}</td>
              <td style={{ ...rightTd, color: "red", fontWeight: 700 }}>
                {formatHours(r.overtimeMinutes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const th = {
  textAlign: "left" as const,
  borderBottom: "1px solid #ccc",
  padding: 8,
};

const right = {
  textAlign: "right" as const,
  borderBottom: "1px solid #ccc",
  padding: 8,
};

const td = {
  padding: 8,
  borderBottom: "1px solid #eee",
};

const rightTd = {
  padding: 8,
  borderBottom: "1px solid #eee",
  textAlign: "right" as const,
};