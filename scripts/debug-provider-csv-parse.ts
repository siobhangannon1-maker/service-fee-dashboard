import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";

type ProviderAppointmentsCsvRow = {
  Provider?: string;
  Date?: string;
  Time?: string;
  Duration?: string | number;
  Value?: string | number;
  "Patient Name"?: string;
  "Treatment Type"?: string;
  "Appt Status"?: string;
  "Arrival Status"?: string;
  "Response Status"?: string;
  "Following Appointment"?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

async function main() {
  const fileArg = process.argv[2];

  if (!fileArg) {
    throw new Error(
      'Usage: npx tsx scripts/debug-provider-csv-parse.ts "/full/path/to/file.csv"'
    );
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const fileContents = await fs.readFile(filePath, "utf8");

  console.log("");
  console.log("========================================");
  console.log("CSV PARSE DEBUG");
  console.log("========================================");
  console.log("File path:", filePath);
  console.log("Character count:", fileContents.length);
  console.log("");

  const rows = parse(fileContents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ProviderAppointmentsCsvRow[];

  console.log("Parsed row count:", rows.length);
  console.log("");

  const byProvider = new Map<
    string,
    {
      rawProvider: string;
      normalizedProvider: string;
      count: number;
      sampleRows: ProviderAppointmentsCsvRow[];
    }
  >();

  for (const row of rows) {
    const rawProvider = normalizeWhitespace(row.Provider ?? "");
    const normalizedProvider = normalizeProviderName(rawProvider);
    const key = normalizedProvider || "(blank)";

    const existing = byProvider.get(key);

    if (existing) {
      existing.count += 1;
      if (existing.sampleRows.length < 3) {
        existing.sampleRows.push(row);
      }
      continue;
    }

    byProvider.set(key, {
      rawProvider,
      normalizedProvider,
      count: 1,
      sampleRows: [row],
    });
  }

  const sorted = Array.from(byProvider.values()).sort((a, b) =>
    a.rawProvider.localeCompare(b.rawProvider)
  );

  console.log("PROVIDERS FOUND IN PARSED CSV");
  console.log("========================================");

  for (const provider of sorted) {
    console.log("");
    console.log(`Provider Raw: ${provider.rawProvider}`);
    console.log(`Provider Normalized: ${provider.normalizedProvider}`);
    console.log(`Row Count: ${provider.count}`);
    console.log("Sample Rows:");
    for (const sample of provider.sampleRows) {
      console.log(
        JSON.stringify(
          {
            Provider: sample.Provider,
            Date: sample.Date,
            Time: sample.Time,
            "Patient Name": sample["Patient Name"],
            "Treatment Type": sample["Treatment Type"],
            "Appt Status": sample["Appt Status"],
            "Arrival Status": sample["Arrival Status"],
            "Response Status": sample["Response Status"],
            "Following Appointment": sample["Following Appointment"],
          },
          null,
          2
        )
      );
    }
  }

  const siobhanRows = rows.filter((row) =>
    normalizeProviderName(row.Provider ?? "").includes("siobhan")
  );

  console.log("");
  console.log("========================================");
  console.log("SIOBHAN CHECK");
  console.log("========================================");
  console.log("Rows containing 'siobhan' in Provider:", siobhanRows.length);

  for (const row of siobhanRows.slice(0, 10)) {
    console.log(
      JSON.stringify(
        {
          Provider: row.Provider,
          Date: row.Date,
          Time: row.Time,
          "Patient Name": row["Patient Name"],
          "Treatment Type": row["Treatment Type"],
        },
        null,
        2
      )
    );
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});