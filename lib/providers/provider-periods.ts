export type ProviderPeriodType = "month" | "year" | "quarter_ato";

export type ProviderPeriod = {
  periodType: ProviderPeriodType;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31);
}

/**
 * ATO quarter mapping:
 * Q1 = Jul-Sep
 * Q2 = Oct-Dec
 * Q3 = Jan-Mar
 * Q4 = Apr-Jun
 *
 * We store keys like:
 *   2025-Q1-ATO  => Jul-Sep 2025
 *   2025-Q2-ATO  => Oct-Dec 2025
 *   2025-Q3-ATO  => Jan-Mar 2026
 *   2025-Q4-ATO  => Apr-Jun 2026
 *
 * The "year" in the key refers to the starting financial year.
 */
export function getAtoQuarterFromDate(date: Date): {
  atoFinancialYearStart: number;
  quarterNumber: 1 | 2 | 3 | 4;
  quarterStart: Date;
  quarterEnd: Date;
} {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  if (month >= 7 && month <= 9) {
    return {
      atoFinancialYearStart: year,
      quarterNumber: 1,
      quarterStart: new Date(year, 6, 1),
      quarterEnd: new Date(year, 8 + 1, 0),
    };
  }

  if (month >= 10 && month <= 12) {
    return {
      atoFinancialYearStart: year,
      quarterNumber: 2,
      quarterStart: new Date(year, 9, 1),
      quarterEnd: new Date(year, 11 + 1, 0),
    };
  }

  if (month >= 1 && month <= 3) {
    return {
      atoFinancialYearStart: year - 1,
      quarterNumber: 3,
      quarterStart: new Date(year, 0, 1),
      quarterEnd: new Date(year, 2 + 1, 0),
    };
  }

  return {
    atoFinancialYearStart: year - 1,
    quarterNumber: 4,
    quarterStart: new Date(year, 3, 1),
    quarterEnd: new Date(year, 5 + 1, 0),
  };
}

export function getMonthPeriodFromIsoDate(isoDate: string): ProviderPeriod {
  const date = new Date(`${isoDate}T00:00:00`);
  const start = startOfMonth(date);
  const end = endOfMonth(date);

  return {
    periodType: "month",
    periodKey: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
    periodStart: formatIsoDate(start),
    periodEnd: formatIsoDate(end),
  };
}

export function getYearPeriodFromIsoDate(isoDate: string): ProviderPeriod {
  const date = new Date(`${isoDate}T00:00:00`);
  const start = startOfYear(date);
  const end = endOfYear(date);

  return {
    periodType: "year",
    periodKey: `${start.getFullYear()}`,
    periodStart: formatIsoDate(start),
    periodEnd: formatIsoDate(end),
  };
}

export function getAtoQuarterPeriodFromIsoDate(isoDate: string): ProviderPeriod {
  const date = new Date(`${isoDate}T00:00:00`);
  const quarter = getAtoQuarterFromDate(date);

  return {
    periodType: "quarter_ato",
    periodKey: `${quarter.atoFinancialYearStart}-Q${quarter.quarterNumber}-ATO`,
    periodStart: formatIsoDate(quarter.quarterStart),
    periodEnd: formatIsoDate(quarter.quarterEnd),
  };
}

export function getAllPeriodsForIsoDate(isoDate: string): {
  month: ProviderPeriod;
  year: ProviderPeriod;
  quarterAto: ProviderPeriod;
} {
  return {
    month: getMonthPeriodFromIsoDate(isoDate),
    year: getYearPeriodFromIsoDate(isoDate),
    quarterAto: getAtoQuarterPeriodFromIsoDate(isoDate),
  };
}

export function getCurrentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function formatAtoQuarterLabel(periodKey: string): string {
  const match = periodKey.match(/^(\d{4})-Q([1-4])-ATO$/);

  if (!match) return periodKey;

  const financialYearStart = Number(match[1]);
  const quarterNumber = Number(match[2]);
  const financialYearEndShort = String(financialYearStart + 1).slice(-2);

  const labelByQuarter: Record<number, string> = {
    1: "Jul-Sep",
    2: "Oct-Dec",
    3: "Jan-Mar",
    4: "Apr-Jun",
  };

  return `${financialYearStart}/${financialYearEndShort} Q${quarterNumber} (${labelByQuarter[quarterNumber]})`;
}