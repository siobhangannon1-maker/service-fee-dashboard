import { redirect } from "next/navigation";
import { calculateProviderMonthlyMetrics } from "@/lib/providers/calculate-provider-monthly-metrics";

function isValidYear(value: string | null): value is string {
  return Boolean(value && /^\d{4}$/.test(value));
}

function isValidMonth(value: string | null): value is string {
  return Boolean(value && /^(0[1-9]|1[0-2])$/.test(value));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");

  if (!isValidYear(year) || !isValidMonth(month)) {
    redirect(
      `/admin/provider-imports/test?ok=false&result=${encodeURIComponent(
        "Performance test import failed: invalid year or month."
      )}`
    );
  }

  const monthKey = `${year}-${month}`;

  try {
    // TODO:
    // Replace this section with your real provider performance test import function.
    // Example:
    //
    // const importResult = await importProviderPerformanceTestCsv({
    //   year,
    //   month,
    //   monthKey,
    // });

    const calculationResult = await calculateProviderMonthlyMetrics({
      monthKey,
    });

    const resultMessage = [
      "Performance test import completed successfully.",
      `Month key: ${calculationResult.monthKey}.`,
      `Providers calculated: ${calculationResult.providersCalculated}.`,
    ].join("\n");

    redirect(
      `/admin/provider-imports/test?ok=true&year=${year}&month=${month}&result=${encodeURIComponent(
        resultMessage
      )}`
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? `Performance test import failed:\n${error.message}`
        : "Performance test import failed.";

    redirect(
      `/admin/provider-imports/test?ok=false&year=${year}&month=${month}&result=${encodeURIComponent(
        message
      )}`
    );
  }
}