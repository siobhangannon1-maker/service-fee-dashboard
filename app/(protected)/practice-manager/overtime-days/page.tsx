import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const STANDARD_DAILY_HOURS = 9.5;
const FIXED_BREAK_MINUTES = 30;

type PageProps = {
  searchParams?: Promise<{
    from?: string;
    to?: string;
    staff?: string;
  }>;
};

function formatHours(minutes: number) {
  return (minutes / 60).toFixed(2);
}

function formatTime(ts: number, tz: string) {
  if (!ts) return "-";

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ts * 1000));
}

function getDayName(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
  }).format(new Date(date));
}

function safelyParseRawJson(rawJson: any) {
  try {
    return typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson || {};
  } catch {
    return {};
  }
}

function getShiftMinutes(startTs: number, endTs: number) {
  if (!startTs || !endTs) return 0;
  return Math.max((endTs - startTs) / 60, 0);
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const from = params?.from || "2026-04-01";
  const to = params?.to || "2026-04-10";
  const staffFilter = params?.staff;

  const { data: timesheets } = await supabase
    .from("connecteam_daily_timesheets")
    .select("connecteam_user_id, work_date, total_minutes, raw_json")
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date");

  const { data: users } = await supabase
    .from("connecteam_users")
    .select("connecteam_user_id, display_name");

  const userMap: Record<string, string> = {};

  (users || []).forEach((user: any) => {
    userMap[String(user.connecteam_user_id)] =
      user.display_name || String(user.connecteam_user_id);
  });

  const standardMinutes = STANDARD_DAILY_HOURS * 60;

  const rows = (timesheets || [])
    .map((row: any) => {
      const rawJson = safelyParseRawJson(row.raw_json);

      const totalMinutes = Number(row.total_minutes || 0);
      const paidMinutes = Math.max(totalMinutes - FIXED_BREAK_MINUTES, 0);
      const overtimeMinutes = Math.max(paidMinutes - standardMinutes, 0);

      const records = Array.isArray(rawJson.records) ? rawJson.records : [];

      let cumulativeMinutes = 0;

      const shifts = records.map((record: any) => {
        const timezone =
          record.start?.timezone ||
          record.end?.timezone ||
          "Australia/Brisbane";

        const startTs = Number(record.start?.timestamp || 0);
        const endTs = Number(record.end?.timestamp || 0);
        const shiftMinutes = getShiftMinutes(startTs, endTs);

        const beforeShift = cumulativeMinutes;
        const afterShift = cumulativeMinutes + shiftMinutes;

        cumulativeMinutes = afterShift;

        const causesOvertime =
          beforeShift < standardMinutes + FIXED_BREAK_MINUTES &&
          afterShift > standardMinutes + FIXED_BREAK_MINUTES;

        return {
          start: formatTime(startTs, timezone),
          end: formatTime(endTs, timezone),
          shiftMinutes,
          causesOvertime,
        };
      });

      const staffName =
        userMap[String(row.connecteam_user_id)] || row.connecteam_user_id;

      return {
        staff: staffName,
        date: row.work_date,
        day: getDayName(row.work_date),
        totalMinutes,
        paidMinutes,
        overtimeMinutes,
        shifts,
      };
    })
    .filter((row) => row.overtimeMinutes > 0)
    .filter((row) =>
      staffFilter ? row.staff.toLowerCase() === staffFilter.toLowerCase() : true
    )
    .sort((a, b) => {
      if (a.date === b.date) return a.staff.localeCompare(b.staff);
      return a.date.localeCompare(b.date);
    });

  const totalOT = rows.reduce((sum, row) => sum + row.overtimeMinutes, 0);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Overtime Days</h1>

      <p style={{ marginTop: 8, color: "#555" }}>
        Period: {from} → {to}
      </p>

      <p style={{ marginTop: 4, color: "#555" }}>
        Rule: 30 min break deducted, then overtime after{" "}
        {STANDARD_DAILY_HOURS} paid hours.
      </p>

      {staffFilter && (
        <p style={{ marginTop: 4 }}>
          Staff filter: <strong>{staffFilter}</strong>
        </p>
      )}

      <div
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <strong>Total OT:</strong> {formatHours(totalOT)} hours
      </div>

      <table style={{ width: "100%", marginTop: 24, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Staff</th>
            <th style={th}>Date</th>
            <th style={th}>Day</th>
            <th style={th}>Shifts</th>
            <th style={right}>Total</th>
            <th style={right}>Paid</th>
            <th style={right}>OT</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.staff}-${row.date}-${index}`}>
              <td style={td}>{row.staff}</td>
              <td style={td}>{row.date}</td>
              <td style={td}>{row.day}</td>

              <td style={td}>
                {row.shifts.map((shift: any, shiftIndex: number) => (
                  <div
                    key={shiftIndex}
                    style={{
                      marginBottom: 4,
                      color: shift.causesOvertime ? "red" : "#111",
                      fontWeight: shift.causesOvertime ? 700 : 400,
                    }}
                  >
                    {shift.start} → {shift.end}
                    {shift.causesOvertime && "  ← OT starts here"}
                  </div>
                ))}
              </td>

              <td style={rightTd}>{formatHours(row.totalMinutes)}</td>
              <td style={rightTd}>{formatHours(row.paidMinutes)}</td>

              <td style={{ ...rightTd, color: "red", fontWeight: 700 }}>
                {formatHours(row.overtimeMinutes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && <p style={{ marginTop: 24 }}>No overtime found.</p>}
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