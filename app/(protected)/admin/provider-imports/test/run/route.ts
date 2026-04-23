import { calculateProviderMonthlyMetrics } from "@/lib/providers/calculate-provider-monthly-metrics";

export const dynamic = "force-dynamic";

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
    return new Response(
      [
        "Monthly metrics calculation failed.",
        "Missing or invalid year/month query params.",
        "Expected example: /admin/provider-imports/test/run?year=2026&month=03",
      ].join("\n"),
      {
        status: 400,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  }

  const monthKey = `${year}-${month}`;

  try {
    const result = await calculateProviderMonthlyMetrics({
      monthKey:  "2026-03",
    });

    const message = [
      "Monthly metrics calculation completed successfully.",
      `Month key: ${result.monthKey}.`,
      `Providers calculated: ${result.providersCalculated}.`,
    ].join("\n");

    return new Response(message, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Monthly metrics calculation failed:\n${error.message}`
        : "Monthly metrics calculation failed.";

    return new Response(message, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}