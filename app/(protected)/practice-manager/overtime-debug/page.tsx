import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function formatHours(value: number) {
  return value.toFixed(2);
}

function getDifferenceLabel(difference: number) {
  if (Math.abs(difference) <= 0.25) return "Matched";
  if (difference > 0) return "Connecteam higher";
  return "Xero higher";
}

export default async function OvertimeDebugPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const periodStart = "2026-04-01";
  const periodEnd = "2026-04-10";

  const { data: mappings, error: mappingError } = await supabase
    .from("employee_mapping")
    .select("*")
    .eq("is_active", true);

  const { data: connecteamTotals, error: connecteamError } = await supabase
    .from("connecteam_payroll_totals")
    .select(
      "employee_name, period_start, period_end, total_work_hours, regular_hours, overtime_hours"
    )
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);

  const { data: wageLines, error: xeroError } = await supabase
    .from("staff_wage_lines")
    .select("employee_name, hours, line_type");

  if (mappingError || connecteamError || xeroError) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Overtime Debug</h1>
        <p>Something went wrong loading data.</p>
        <pre>
          {JSON.stringify(
            { mappingError, connecteamError, xeroError },
            null,
            2
          )}
        </pre>
      </main>
    );
  }

  const connecteamByName: Record<
    string,
    {
      totalWorkHours: number;
      regularHours: number;
      overtimeHours: number;
    }
  > = {};

  (connecteamTotals || []).forEach((row: any) => {
    const name = String(row.employee_name || "").trim();
    if (!name) return;

    if (!connecteamByName[name]) {
      connecteamByName[name] = {
        totalWorkHours: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    connecteamByName[name].totalWorkHours += Number(row.total_work_hours || 0);
    connecteamByName[name].regularHours += Number(row.regular_hours || 0);
    connecteamByName[name].overtimeHours += Number(row.overtime_hours || 0);
  });

  const xeroByName: Record<string, number> = {};

  (wageLines || []).forEach((row: any) => {
    const name = String(row.employee_name || "").trim();
    const lineType = String(row.line_type || "").toLowerCase();

    if (!name) return;

    if (lineType === "overtime") {
      xeroByName[name] = (xeroByName[name] || 0) + Number(row.hours || 0);
    }
  });

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Overtime Debug — Connecteam vs Xero
      </h1>

      <p style={{ marginTop: 8, color: "#555" }}>
        Period: {periodStart} → {periodEnd}
      </p>

      <p style={{ marginTop: 8, color: "#b45309" }}>
        Note: your current staff_wage_lines table only has normalized line_type,
        not the exact Xero pay item name. This page currently counts only
        line_type = overtime.
      </p>

      <table
        style={{
          width: "100%",
          marginTop: 24,
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Staff</th>
            <th style={rightThStyle}>Connecteam Total Hours</th>
            <th style={rightThStyle}>Connecteam OT</th>
            <th style={rightThStyle}>Xero OT</th>
            <th style={rightThStyle}>Difference</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>

        <tbody>
          {(mappings || []).map((mapping: any) => {
            const xeroName = String(mapping.xero_employee_name || "").trim();
            const connecteamName = String(
              mapping.connecteam_user_name || ""
            ).trim();

            const connecteam =
              connecteamByName[connecteamName] ||
              connecteamByName[xeroName] || {
                totalWorkHours: 0,
                regularHours: 0,
                overtimeHours: 0,
              };

            const xeroOvertime = xeroByName[xeroName] || 0;
            const difference = connecteam.overtimeHours - xeroOvertime;
            const status = getDifferenceLabel(difference);

            return (
              <tr key={mapping.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{xeroName}</div>
                  <div style={{ fontSize: 12, color: "#777" }}>
                    Connecteam: {connecteamName || "Not mapped"}
                  </div>
                </td>

                <td style={rightTdStyle}>
                  {formatHours(connecteam.totalWorkHours)}
                </td>

                <td style={rightTdStyle}>
                  {formatHours(connecteam.overtimeHours)}
                </td>

                <td style={rightTdStyle}>{formatHours(xeroOvertime)}</td>

                <td
                  style={{
                    ...rightTdStyle,
                    color: Math.abs(difference) > 1 ? "red" : "green",
                    fontWeight: 700,
                  }}
                >
                  {formatHours(difference)}
                </td>

                <td style={tdStyle}>{status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ccc",
  padding: 8,
};

const rightThStyle: React.CSSProperties = {
  textAlign: "right",
  borderBottom: "1px solid #ccc",
  padding: 8,
};

const tdStyle: React.CSSProperties = {
  padding: 8,
  borderBottom: "1px solid #eee",
};

const rightTdStyle: React.CSSProperties = {
  padding: 8,
  borderBottom: "1px solid #eee",
  textAlign: "right",
};