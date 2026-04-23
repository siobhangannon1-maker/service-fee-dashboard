import { redirect } from "next/navigation";

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
        "Appointments test import failed: invalid year or month."
      )}`
    );
  }

  const monthKey = `${year}-${month}`;

  try {
    // TODO:
    // Replace this section with your real appointments test import function.
    // Example:
    //
    // const result = await importProviderAppointmentsTestCsv({
    //   year,
    //   month,
    //   monthKey,
    // });

    const resultMessage = [
      "Appointments test import completed successfully.",
      `Month key: ${monthKey}.`,
      "No real appointments import function is connected yet.",
      "This route is ready to receive your real import function.",
    ].join("\n");

    redirect(
      `/admin/provider-imports/test?ok=true&year=${year}&month=${month}&result=${encodeURIComponent(
        resultMessage
      )}`
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? `Appointments test import failed:\n${error.message}`
        : "Appointments test import failed.";

    redirect(
      `/admin/provider-imports/test?ok=false&year=${year}&month=${month}&result=${encodeURIComponent(
        message
      )}`
    );
  }
}