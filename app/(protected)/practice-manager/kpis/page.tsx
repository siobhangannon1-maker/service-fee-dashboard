import { requireRole } from "@/lib/auth";
import {
  getAtoQuarterOptions,
  getMonthOptions,
  getWeeksForPeriod,
  getYearOptions,
  type KpiView,
} from "../../../../lib/practice-manager/kpi-periods";
import { getWeeklyCancellationFtaKpis } from "../../../../lib/practice-manager/get-weekly-cancellation-fta-kpis";
import { getMonthlyGapKpi } from "../../../../lib/practice-manager/get-monthly-gap-kpi";

type PageProps = {
  searchParams?: Promise<{
    view?: string;
    periodKey?: string;
    year?: string;
    month?: string;
  }>;
};

function isValidView(value: string | undefined): value is KpiView {
  return value === "month" || value === "quarter_ato" || value === "year";
}

function getDefaultPeriodKey(view: KpiView): string {
  const now = new Date();

  if (view === "month") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  if (view === "year") {
    return String(now.getFullYear());
  }

  const month = now.getMonth() + 1;
  const fyStart = month >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  if (month >= 7 && month <= 9) return `${fyStart}-Q1-ATO`;
  if (month >= 10 && month <= 12) return `${fyStart}-Q2-ATO`;
  if (month >= 1 && month <= 3) return `${fyStart}-Q3-ATO`;
  return `${fyStart}-Q4-ATO`;
}

function getPeriodOptions(view: KpiView) {
  if (view === "month") return getMonthOptions();
  if (view === "year") return getYearOptions();
  return getAtoQuarterOptions();
}

function buildHref(view: KpiView, periodKey: string) {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("periodKey", periodKey);
  return `/practice-manager/kpis?${params.toString()}`;
}

function viewLabel(view: KpiView) {
  if (view === "month") return "Month";
  if (view === "quarter_ato") return "ATO Quarter";
  return "Year";
}

function formatPercent(value: number | null | undefined): string {
  const safeValue = Number(value ?? 0);
  return `${(safeValue * 100).toFixed(2)}%`;
}

function formatHours(value: number | null | undefined): string {
  const safeValue = Number(value ?? 0);
  return `${safeValue.toFixed(2)} h`;
}

function getMonthKeyFromYearAndMonth(year: string, month: string): string {
  return `${year}-${month}`;
}

function getMonthYears(monthOptions: Array<{ key: string; label: string }>): string[] {
  return Array.from(new Set(monthOptions.map((option) => option.key.slice(0, 4)))).sort();
}

function getMonthsForYear(
  monthOptions: Array<{ key: string; label: string }>,
  year: string
): Array<{ key: string; label: string; month: string }> {
  return monthOptions
    .filter((option) => option.key.slice(0, 4) === year)
    .map((option) => ({
      key: option.key,
      label: option.label,
      month: option.key.slice(5, 7),
    }));
}

export default async function PracticeManagerKpisPage({ searchParams }: PageProps) {
  await requireRole(["admin", "practice_manager"]);

  const resolved = await searchParams;
  const selectedView: KpiView = isValidView(resolved?.view) ? resolved.view : "month";

  const periodOptions = getPeriodOptions(selectedView);

  let selectedPeriodKey = resolved?.periodKey || getDefaultPeriodKey(selectedView);

  let selectedMonthYear = "";
  let selectedMonthNumber = "";

  if (selectedView === "month") {
    const monthOptions = getMonthOptions();
    const defaultMonthKey = getDefaultPeriodKey("month");
    const fallbackYear = defaultMonthKey.slice(0, 4);
    const fallbackMonth = defaultMonthKey.slice(5, 7);

    selectedMonthYear = resolved?.year ?? selectedPeriodKey.slice(0, 4) ?? fallbackYear;
    selectedMonthNumber = resolved?.month ?? selectedPeriodKey.slice(5, 7) ?? fallbackMonth;

    const monthYears = getMonthYears(monthOptions);
    if (!monthYears.includes(selectedMonthYear)) {
      selectedMonthYear = fallbackYear;
    }

    const monthsForYear = getMonthsForYear(monthOptions, selectedMonthYear);
    if (!monthsForYear.some((option) => option.month === selectedMonthNumber)) {
      selectedMonthNumber = monthsForYear[0]?.month ?? fallbackMonth;
    }

    selectedPeriodKey = getMonthKeyFromYearAndMonth(selectedMonthYear, selectedMonthNumber);
  }

  const safePeriodKey =
    periodOptions.some((option) => option.key === selectedPeriodKey)
      ? selectedPeriodKey
      : (periodOptions[0]?.key ?? getDefaultPeriodKey(selectedView));

  const weeks = getWeeksForPeriod(selectedView, safePeriodKey);
  const weeklyKpis = await getWeeklyCancellationFtaKpis(weeks);

  const monthOptions = getMonthOptions();
  const monthYears = getMonthYears(monthOptions);
  const monthsForSelectedYear =
    selectedView === "month" ? getMonthsForYear(monthOptions, selectedMonthYear) : [];

  const monthlyGap =
    selectedView === "month" ? await getMonthlyGapKpi(safePeriodKey) : null;

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Practice Manager KPIs</h1>
      <p style={subheadingStyle}>
        Weekly KPI dashboard for clinical and operational performance.
      </p>

      <section style={panelStyle}>
        <div style={toggleRowStyle}>
          <a
            href={buildHref("month", getDefaultPeriodKey("month"))}
            style={selectedView === "month" ? activeTabStyle : tabStyle}
          >
            Month
          </a>
          <a
            href={buildHref("quarter_ato", getDefaultPeriodKey("quarter_ato"))}
            style={selectedView === "quarter_ato" ? activeTabStyle : tabStyle}
          >
            ATO Quarter
          </a>
          <a
            href={buildHref("year", getDefaultPeriodKey("year"))}
            style={selectedView === "year" ? activeTabStyle : tabStyle}
          >
            Year
          </a>
        </div>

        {selectedView === "month" ? (
          <form method="get" style={filterRowStyle}>
            <input type="hidden" name="view" value="month" />

            <div>
              <label style={labelStyle}>Year</label>
              <select name="year" defaultValue={selectedMonthYear} style={selectStyle}>
                {monthYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Month</label>
              <select name="month" defaultValue={selectedMonthNumber} style={selectStyle}>
                {monthsForSelectedYear.map((option) => (
                  <option key={option.key} value={option.month}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" style={buttonStyle}>
              Apply
            </button>
          </form>
        ) : (
          <form method="get" style={filterRowStyle}>
            <input type="hidden" name="view" value={selectedView} />

            <div>
              <label style={labelStyle}>{viewLabel(selectedView)}</label>
              <select name="periodKey" defaultValue={safePeriodKey} style={selectStyle}>
                {periodOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" style={buttonStyle}>
              Apply
            </button>
          </form>
        )}
      </section>

      <section style={panelStyle}>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Week</th>
                <th style={thStyle}>Referral Booking %</th>
                <th style={thStyle}>Gap %</th>
                <th style={thStyle}>FTA %</th>
                <th style={thStyle}>Cancellation %</th>
                <th style={thStyle}>Overtime</th>
                <th style={thStyle}>Billing / Staffing</th>
              </tr>
            </thead>

            <tbody>
              {weeklyKpis.map((week, index) => (
                <tr key={week.weekStart}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>
                      {weeks.find((item) => item.weekStart === week.weekStart)?.label ?? week.weekStart}
                    </div>
                    <div style={dateRangeStyle}>
                      {week.weekStart} to {week.weekEnd}
                    </div>
                    <div style={metaStyle}>{week.totalAppointments} appointments</div>
                  </td>

                  <td style={tdStyle}>-</td>

                  {selectedView === "month" ? (
                    index === 0 ? (
                      <td style={mergedGapTdStyle} rowSpan={Math.max(weeklyKpis.length, 1)}>
                        <div style={valueStyle}>{formatPercent(monthlyGap?.gapPct)}</div>
                        <div style={metaStyle}>{formatHours(monthlyGap?.hoursBilled)} billed</div>
                        <div style={metaStyle}>{formatHours(monthlyGap?.hoursScheduled)} scheduled</div>
                      </td>
                    ) : null
                  ) : (
                    <td style={tdStyle}>-</td>
                  )}

                  <td style={tdStyle}>
                    <div style={valueStyle}>{formatPercent(week.ftaPct)}</div>
                    <div style={metaStyle}>{week.ftaCount} FTAs</div>
                  </td>

                  <td style={tdStyle}>
                    <div style={valueStyle}>{formatPercent(week.cancelNoRebookPct)}</div>
                    <div style={metaStyle}>{week.cancelNoRebookCount} cancelled no rebook</div>
                  </td>

                  <td style={tdStyle}>-</td>
                  <td style={tdStyle}>-</td>
                </tr>
              ))}

              {weeklyKpis.length === 0 ? (
                <tr>
                  <td colSpan={7} style={tdStyle}>
                    No weeks found for the selected period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "24px",
  maxWidth: "1400px",
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  marginBottom: "8px",
};

const subheadingStyle: React.CSSProperties = {
  marginBottom: "20px",
  color: "#475569",
};

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "16px",
  padding: "20px",
  marginBottom: "20px",
};

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  marginBottom: "16px",
  flexWrap: "wrap",
};

const tabStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid #d1d5db",
  textDecoration: "none",
  color: "#374151",
  background: "#ffffff",
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: "#111827",
  color: "#ffffff",
  border: "1px solid #111827",
};

const filterRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "end",
  flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  marginBottom: "6px",
  color: "#374151",
};

const selectStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  minWidth: "220px",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "980px",
};

const thStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: "12px",
  background: "#f3f4f6",
  textAlign: "left",
  fontWeight: 700,
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: "12px",
  verticalAlign: "top",
};

const mergedGapTdStyle: React.CSSProperties = {
  ...tdStyle,
  verticalAlign: "middle",
  background: "#f9fafb",
  minWidth: "160px",
};

const dateRangeStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  marginTop: "4px",
};

const valueStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "16px",
};

const metaStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  marginTop: "4px",
};