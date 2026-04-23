type SearchParams = Promise<{
  result?: string;
  ok?: string;
  year?: string;
  month?: string;
}>;

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const YEAR_OPTIONS = ["2024", "2025", "2026", "2027", "2028"];

function ImportCard({
  title,
  description,
  runPath,
  defaultYear,
  defaultMonth,
}: {
  title: string;
  description: string;
  runPath: string;
  defaultYear: string;
  defaultMonth: string;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{description}</p>

      <form action={runPath} method="get" className="mt-5 grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor={`${title}-year`} className="mb-2 block text-sm font-medium text-gray-700">
            Year
          </label>
          <select
            id={`${title}-year`}
            name="year"
            defaultValue={defaultYear}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-gray-400"
          >
            {YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`${title}-month`}
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            Month
          </label>
          <select
            id={`${title}-month`}
            name="month"
            defaultValue={defaultMonth}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-gray-400"
          >
            {MONTH_OPTIONS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Run test import
          </button>
        </div>
      </form>
    </section>
  );
}

export default async function ProviderImportsTestPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const result = resolvedSearchParams?.result ?? "";
  const ok = resolvedSearchParams?.ok ?? "";
  const selectedYear = resolvedSearchParams?.year ?? "2026";
  const selectedMonth = resolvedSearchParams?.month ?? "04";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Provider Imports Test
        </h1>

        <p className="mt-2 text-sm text-gray-600">
          Run local sample CSV imports using a selected year and month. This is useful for monthly
          provider appointment and performance uploads.
        </p>

        <div className="mt-8 grid gap-6">
          <ImportCard
            title="Appointments test import"
            description="Use this to import appointment sample data for a selected month."
            runPath="/admin/provider-imports/test/run/appointments"
            defaultYear={selectedYear}
            defaultMonth={selectedMonth}
          />

          <ImportCard
            title="Performance test import"
            description="Use this to import provider performance sample data for a selected month."
            runPath="/admin/provider-imports/test/run/performance"
            defaultYear={selectedYear}
            defaultMonth={selectedMonth}
          />

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
            <div className="font-medium">Selected period</div>
            <div className="mt-1">
              Year: <span className="font-semibold">{selectedYear}</span>
            </div>
            <div>
              Month: <span className="font-semibold">{selectedMonth}</span>
            </div>
          </section>

          <section
            className={[
              "rounded-2xl border p-4 text-sm whitespace-pre-wrap",
              ok === "true"
                ? "border-green-200 bg-green-50 text-green-800"
                : result
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-gray-200 bg-white text-gray-700",
            ].join(" ")}
          >
            {result || "The exact result will appear here after you run an import."}
          </section>
        </div>
      </div>
    </main>
  );
}