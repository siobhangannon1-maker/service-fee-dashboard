"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type PeriodType = "month" | "quarter_ato" | "year";

export default function KpiDateSelector({
  selectedYear,
  selectedPeriodType,
  selectedMonth,
  selectedQuarter,
  availableYears,
  monthOptionsForYear,
  quarterOptionsForYear,
}: {
  selectedYear: string;
  selectedPeriodType: PeriodType;
  selectedMonth: string;
  selectedQuarter: string;
  availableYears: string[];
  monthOptionsForYear: Array<{ key: string; label: string; periodKey: string }>;
  quarterOptionsForYear: Array<{ key: string; label: string; periodKey: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [year, setYear] = useState(selectedYear);
  const [periodType, setPeriodType] = useState<PeriodType>(selectedPeriodType);
  const [month, setMonth] = useState(selectedMonth);
  const [quarter, setQuarter] = useState(selectedQuarter);

  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());

    params.set("year", year);
    params.set("periodType", periodType);

    if (periodType === "month") {
      params.set("month", month);
      params.delete("quarter");
    }

    if (periodType === "quarter_ato") {
      params.set("quarter", quarter);
      params.delete("month");
    }

    if (periodType === "year") {
      params.delete("month");
      params.delete("quarter");
    }

    router.push(`/practice-manager/kpis?${params.toString()}`);
  }

  return (
    <div style={formStyle}>
      <label style={labelStyle}>
        Year
        <select
          value={year}
          onChange={(event) => setYear(event.target.value)}
          style={selectStyle}
        >
          {availableYears.map((yearOption) => (
            <option key={yearOption} value={yearOption}>
              {yearOption}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        View by
        <select
          value={periodType}
          onChange={(event) => setPeriodType(event.target.value as PeriodType)}
          style={selectStyle}
        >
          <option value="month">Month</option>
          <option value="quarter_ato">ATO quarter</option>
          <option value="year">Full year</option>
        </select>
      </label>

      {periodType === "month" && (
        <label style={labelStyle}>
          Month
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            style={selectStyle}
          >
            {monthOptionsForYear.map((option) => (
              <option key={option.key} value={option.periodKey}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {periodType === "quarter_ato" && (
        <label style={labelStyle}>
          ATO quarter
          <select
            value={quarter}
            onChange={(event) => setQuarter(event.target.value)}
            style={selectStyle}
          >
            {quarterOptionsForYear.map((option) => (
              <option key={option.key} value={option.periodKey}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="button" onClick={applyFilters} style={buttonStyle}>
        Apply
      </button>
    </div>
  );
}

const formStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(170px, 1fr)) auto",
  gap: "12px",
  alignItems: "end",
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 800,
  color: "#334155",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  backgroundColor: "#ffffff",
  color: "#0f172a",
  fontWeight: 700,
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#0f172a",
  color: "#ffffff",
  border: "none",
  borderRadius: "10px",
  padding: "11px 18px",
  fontSize: "14px",
  fontWeight: 800,
  cursor: "pointer",
};