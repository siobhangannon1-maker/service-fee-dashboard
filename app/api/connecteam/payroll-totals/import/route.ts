import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const headerIndex = lines.findIndex((line) =>
    line.toLowerCase().includes("first name,last name")
  );

  if (headerIndex === -1) {
    throw new Error("Could not find CSV header row with First name, Last name");
  }

  const headers = parseCsvLine(lines[headerIndex]);

  return lines.slice(headerIndex + 1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function timeToHours(value: string): number {
  if (!value) return 0;

  const cleaned = value.trim();

  if (!cleaned) return 0;

  if (cleaned.includes(":")) {
    const [hoursPart, minutesPart] = cleaned.split(":");
    const hours = Number(hoursPart || 0);
    const minutes = Number(minutesPart || 0);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;

    return hours + minutes / 60;
  }

  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseDate(value: string): string | null {
  if (!value) return null;

  const parts = value.split("/");

  if (parts.length !== 3) return null;

  const day = parts[0].padStart(2, "0");
  const month = parts[1].padStart(2, "0");
  const year = parts[2];

  return `${year}-${month}-${day}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No CSV file uploaded" },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const parsedRows = parseCsv(csvText);

    const rows = parsedRows
      .map((row) => {
        const firstName = row["First name"] || "";
        const lastName = row["Last name"] || "";
        const employeeName = `${firstName} ${lastName}`.trim();

        const periodStart = parseDate(row["Start date"] || "");
        const periodEnd = parseDate(row["End date"] || "");

        return {
          connecteam_user_id: null,
          employee_name: employeeName,

          period_start: periodStart,
          period_end: periodEnd,

          total_work_hours: timeToHours(row["Total work hours"] || ""),
          regular_hours: timeToHours(row["Regular"] || ""),
          overtime_hours: timeToHours(row["Total overtime"] || ""),

          raw_json: row,
        };
      })
      .filter((row) => row.employee_name && row.period_start && row.period_end);

    if (!rows.length) {
      return NextResponse.json(
        { error: "No valid payroll rows found in CSV" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from("connecteam_payroll_totals")
      .insert(rows);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      message: "Connecteam payroll totals imported successfully",
      rowsImported: rows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
      },
      { status: 500 }
    );
  }
}