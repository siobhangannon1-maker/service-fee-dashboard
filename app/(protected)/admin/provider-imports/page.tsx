import { ProviderImportForm } from "./provider-import-form";
import { runProviderImports } from "./actions";
import { getImportBatches } from "./get-import-batches";
import { deleteImportBatch } from "./delete-import-batch";
import { linkImportBatchMonth } from "./link-import-batch-month";
import { unlinkImportBatchMonth } from "./unlink-import-batch-month";
import RecalculateMonthButton from "./RecalculateMonthButton";

type BatchRow = Awaited<ReturnType<typeof getImportBatches>>[number];

function formatMonthLabel(monthKey: string | null): string {
  if (!monthKey) return "Not linked";

  const [year, month] = monthKey.split("-");
  const monthNames: Record<string, string> = {
    "01": "January",
    "02": "February",
    "03": "March",
    "04": "April",
    "05": "May",
    "06": "June",
    "07": "July",
    "08": "August",
    "09": "September",
    "10": "October",
    "11": "November",
    "12": "December",
  };

  return `${monthNames[month] ?? month} ${year}`;
}

function getTypeBadgeClass(isActive: boolean) {
  return isActive
    ? "border-green-200 bg-green-50 text-green-700"
    : "border-gray-200 bg-gray-50 text-gray-500";
}

function groupLinkedBatchesByMonth(batches: BatchRow[]) {
  const monthMap = new Map<string, BatchRow[]>();

  for (const batch of batches) {
    if (!batch.month_key || !batch.is_linked) continue;

    const existing = monthMap.get(batch.month_key) ?? [];
    existing.push(batch);
    monthMap.set(batch.month_key, existing);
  }

  return Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, rows]) => {
      const linkedTypes = rows.map((row) => row.import_type);
      const hasAppointments = linkedTypes.includes("appointments");
      const hasPerformance = linkedTypes.includes("performance");
      const canRecalculate = hasAppointments && hasPerformance;

      return {
        monthKey,
        rows,
        hasAppointments,
        hasPerformance,
        canRecalculate,
      };
    });
}

export default async function ProviderImportsPage() {
  const batches = await getImportBatches();
  const linkedMonths = groupLinkedBatchesByMonth(batches);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Provider Imports
        </h1>

        <p className="mt-2 text-sm text-gray-600">
          Upload provider appointments and provider performance CSV files for a selected month.
        </p>

        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Important</div>
          <p className="mt-1">
            Use upload to replace raw data for a month. Use <strong>Recalculate only</strong> when
            the raw data is already correct and you only need to rebuild provider metrics.
          </p>
        </div>

        <div className="mt-6">
          <ProviderImportForm action={runProviderImports} />
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">Recalculate by Month</h2>

          {linkedMonths.length === 0 ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
              No linked months found yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {linkedMonths.map(
                ({
                  monthKey,
                  rows,
                  hasAppointments,
                  hasPerformance,
                  canRecalculate,
                }) => (
                  <div
                    key={monthKey}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {formatMonthLabel(monthKey)}
                        </div>

                        <div className="mt-1 text-xs text-gray-500">
                          Linked batches: {rows.length}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-medium ${getTypeBadgeClass(
                              hasAppointments
                            )}`}
                          >
                            Appointments {hasAppointments ? "linked" : "missing"}
                          </span>

                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-medium ${getTypeBadgeClass(
                              hasPerformance
                            )}`}
                          >
                            Performance {hasPerformance ? "linked" : "missing"}
                          </span>
                        </div>
                      </div>

                      <div className="md:w-64">
                        <RecalculateMonthButton
                          monthKey={monthKey}
                          disabled={!canRecalculate}
                          disabledReason={
                            canRecalculate
                              ? undefined
                              : "Both linked types are required before recalculation can run."
                          }
                        />
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">Existing Uploads</h2>

          {batches.length === 0 ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
              No uploads found yet.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {batches.map((batch) => (
                <div
                  key={batch.import_batch_id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {batch.source_file_name}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Batch: {batch.import_batch_id}
                      </div>
                      <div className="text-xs text-gray-500">Type: {batch.import_type}</div>
                      <div className="text-xs text-gray-500">Rows: {batch.row_count}</div>
                      <div className="text-xs text-gray-500">
                        Month: {formatMonthLabel(batch.month_key)}
                      </div>
                      <div className="text-xs text-gray-500">
                        Status: {batch.is_linked ? "Linked" : "Unlinked"}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:w-72">
                      <form action={linkImportBatchMonth} className="flex gap-2">
                        <input type="hidden" name="batchId" value={batch.import_batch_id} />
                        <input
                          type="month"
                          name="monthKey"
                          defaultValue={batch.month_key ?? ""}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                          required
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-black px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
                        >
                          Link
                        </button>
                      </form>

                      <form action={unlinkImportBatchMonth}>
                        <input type="hidden" name="batchId" value={batch.import_batch_id} />
                        <button
                          type="submit"
                          className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                        >
                          Unlink
                        </button>
                      </form>

                      <form action={deleteImportBatch}>
                        <input type="hidden" name="batchId" value={batch.import_batch_id} />
                        <input type="hidden" name="importType" value={batch.import_type} />
                        <button
                          type="submit"
                          className="w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}