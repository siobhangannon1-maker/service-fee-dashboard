export type KpiView = "month" | "quarter_ato" | "year";

export type WeekRow = {
  weekStart: string;
  weekEnd: string;
  label: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month - 1, 1);
}

function endOfMonth(year: number, month: number) {
  return new Date(year, month, 0);
}

function startOfYear(year: number) {
  return new Date(year, 0, 1);
}

function endOfYear(year: number) {
  return new Date(year, 11, 31);
}

function getStartOfWeekMonday(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay(); // Sun=0, Mon=1, ... Sat=6
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getEndOfWeekSunday(date: Date): Date {
  const start = getStartOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(0, 0, 0, 0);
  return end;
}

function getAtoQuarterRange(periodKey: string): { start: Date; end: Date } {
  const match = periodKey.match(/^(\d{4})-Q([1-4])-ATO$/);

  if (!match) {
    throw new Error(`Invalid ATO quarter key: ${periodKey}`);
  }

  const financialYearStart = Number(match[1]);
  const quarterNumber = Number(match[2]);

  if (quarterNumber === 1) {
    return {
      start: new Date(financialYearStart, 6, 1),
      end: new Date(financialYearStart, 8, 30),
    };
  }

  if (quarterNumber === 2) {
    return {
      start: new Date(financialYearStart, 9, 1),
      end: new Date(financialYearStart, 11, 31),
    };
  }

  if (quarterNumber === 3) {
    return {
      start: new Date(financialYearStart + 1, 0, 1),
      end: new Date(financialYearStart + 1, 2, 31),
    };
  }

  return {
    start: new Date(financialYearStart + 1, 3, 1),
    end: new Date(financialYearStart + 1, 5, 30),
  };
}

export function getMonthOptions(count = 18): Array<{ key: string; label: string }> {
  const now = new Date();
  const options: Array<{ key: string; label: string }> = [];

  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${pad2(month)}`;
    const label = new Intl.DateTimeFormat("en-AU", {
      month: "long",
      year: "numeric",
    }).format(date);

    options.push({ key, label });
  }

  return options;
}

export function getYearOptions(count = 5): Array<{ key: string; label: string }> {
  const now = new Date();
  const options: Array<{ key: string; label: string }> = [];

  for (let i = 0; i < count; i += 1) {
    const year = now.getFullYear() - i;
    options.push({ key: String(year), label: String(year) });
  }

  return options;
}

export function getAtoQuarterOptions(count = 8): Array<{ key: string; label: string }> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const currentFinancialYearStart = month >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  const options: Array<{ key: string; label: string }> = [];
  const quarterLabels: Record<number, string> = {
    1: "Jul-Sep",
    2: "Oct-Dec",
    3: "Jan-Mar",
    4: "Apr-Jun",
  };

  for (let i = 0; i < count; i += 1) {
    const quarterIndex = i % 4;
    const yearOffset = Math.floor(i / 4);
    const fyStart = currentFinancialYearStart - yearOffset;
    const quarterNumber = 4 - quarterIndex;
    const key = `${fyStart}-Q${quarterNumber}-ATO`;
    const fyEndShort = String(fyStart + 1).slice(-2);
    const label = `${fyStart}/${fyEndShort} Q${quarterNumber} (${quarterLabels[quarterNumber]})`;

    options.push({ key, label });
  }

  return options;
}

export function getPeriodRange(view: KpiView, periodKey: string): { start: Date; end: Date } {
  if (view === "month") {
    const match = periodKey.match(/^(\d{4})-(\d{2})$/);

    if (!match) {
      throw new Error(`Invalid month key: ${periodKey}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);

    return {
      start: startOfMonth(year, month),
      end: endOfMonth(year, month),
    };
  }

  if (view === "year") {
    const year = Number(periodKey);

    if (!year) {
      throw new Error(`Invalid year key: ${periodKey}`);
    }

    return {
      start: startOfYear(year),
      end: endOfYear(year),
    };
  }

  return getAtoQuarterRange(periodKey);
}

export function getWeeksForPeriod(view: KpiView, periodKey: string): WeekRow[] {
  const { start, end } = getPeriodRange(view, periodKey);

  const displayStart = getStartOfWeekMonday(start);
  const displayEnd = view === "month" ? getEndOfWeekSunday(end) : end;

  const weeks: WeekRow[] = [];
  let cursor = new Date(displayStart);

  while (cursor <= displayEnd) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);

    if (view !== "month" && weekEnd > displayEnd) {
      weekEnd.setTime(displayEnd.getTime());
    }

    weeks.push({
      weekStart: formatIsoDate(weekStart),
      weekEnd: formatIsoDate(weekEnd),
      label: `${weekStart.getDate()} ${
        new Intl.DateTimeFormat("en-AU", { month: "short" }).format(weekStart)
      } - ${weekEnd.getDate()} ${
        new Intl.DateTimeFormat("en-AU", { month: "short" }).format(weekEnd)
      }`,
    });

    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}