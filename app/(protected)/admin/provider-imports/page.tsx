import PageLayout from "@/components/ui/PageLayout";
import PageSection from "@/components/ui/PageSection";
import CollapsibleSection from "@/components/ui/CollapsibleSection";

import { getImportBatches } from "./get-import-batches";
import { deleteImportBatch } from "./delete-import-batch";
import { linkImportBatchMonth } from "./link-import-batch-month";
import { unlinkImportBatchMonth } from "./unlink-import-batch-month";
import RecalculateMonthButton from "./RecalculateMonthButton";
import PraktikaSyncPanel from "./PraktikaSyncPanel";
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel";

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
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-500";
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
      const hasCancellations = linkedTypes.includes("cancellations");
      const canRecalculate = hasAppointments && hasPerformance;

      return {
        monthKey,
        rows,
        hasAppointments,
        hasPerformance,
        hasCancellations,
        canRecalculate,
      };
    });
}

function getBatchDisplayKey(batch: BatchRow): string {
  return `${batch.import_batch_id}-${batch.month_key ?? "no-month"}-${
    batch.import_type
  }`;
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white shadow-sm backdrop-blur">
      <div className="text-xs font-medium uppercase tracking-wide text-white/70">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-white/70">{helper}</div>
    </div>
  );
}

export default async function ProviderImportsPage() {
  const batches = await getImportBatches();
  const linkedMonths = groupLinkedBatchesByMonth(batches);

  const readyToRecalculate = linkedMonths.filter(
    (month) => month.canRecalculate,
  ).length;

  const missingDataMonths = linkedMonths.filter(
    (month) => !month.canRecalculate,
  ).length;

  return (
    <PageLayout
      eyebrow="Admin"
      title="Provider Imports"
      description="Sync provider data from Praktika for appointments, performance, cancellations, and new patients."
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                Provider data hub
              </div>

              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Keep data synced, linked, and ready for reporting.
              </h2>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                Use Praktika sync to pull current provider data. Recalculate
                months once appointments and performance data are linked.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Total batches"
                value={batches.length}
                helper="Synced import batches"
              />
              <StatCard
                label="Linked months"
                value={linkedMonths.length}
                helper="Months connected to batches"
              />
              <StatCard
                label="Ready"
                value={readyToRecalculate}
                helper="Months ready to recalculate"
              />
              <StatCard
                label="Needs attention"
                value={missingDataMonths}
                helper="Months missing required data"
              />
            </div>
          </div>
        </div>
      </section>

      <PageSection
        title="Sync from Praktika"
        description="Use this when you want to pull provider data directly from Praktika."
      >
        <div className="space-y-4">
          <PraktikaSessionPanel scope="user" title="My Praktika Session" />
          <PraktikaSyncPanel />
        </div>
      </PageSection>

      <PageSection
        title="Recalculate by month"
        description="A month can be recalculated once appointments and performance data are linked."
      >
        {linkedMonths.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            No linked months found yet.
          </div>
        ) : (
          <div className="space-y-3">
            {linkedMonths.map(
              ({
                monthKey,
                rows,
                hasAppointments,
                hasPerformance,
                hasCancellations,
                canRecalculate,
              }) => (
                <div
                  key={monthKey}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-950">
                        {formatMonthLabel(monthKey)}
                      </div>

                      <div className="mt-1 text-sm text-slate-500">
                        {rows.length} linked batch{rows.length === 1 ? "" : "es"}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${getTypeBadgeClass(
                            hasAppointments,
                          )}`}
                        >
                          Appointments {hasAppointments ? "linked" : "missing"}
                        </span>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${getTypeBadgeClass(
                            hasPerformance,
                          )}`}
                        >
                          Performance {hasPerformance ? "linked" : "missing"}
                        </span>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${getTypeBadgeClass(
                            hasCancellations,
                          )}`}
                        >
                          Cancellations{" "}
                          {hasCancellations ? "linked" : "optional / missing"}
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
                            : "Appointments and performance are required before recalculation can run."
                        }
                      />
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </PageSection>

      <CollapsibleSection
        title={`Previous batches (${batches.length})`}
        description="Historical sync records, linking tools, and delete actions."
      >
        {batches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            No batches found yet.
          </div>
        ) : (
          <div className="space-y-4">
            {batches.map((batch) => (
              <div
                key={getBatchDisplayKey(batch)}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      {batch.source_file_name}
                    </div>

                    <div className="mt-2 grid gap-1 text-xs text-slate-500">
                      <div>Batch: {batch.import_batch_id}</div>
                      <div>Type: {batch.import_type}</div>
                      <div>Rows: {batch.row_count}</div>
                      <div>Month: {formatMonthLabel(batch.month_key)}</div>
                      <div>
                        Status:{" "}
                        <span
                          className={
                            batch.is_linked
                              ? "font-medium text-emerald-700"
                              : "font-medium text-slate-500"
                          }
                        >
                          {batch.is_linked ? "Linked" : "Unlinked"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 md:w-72">
                    <form action={linkImportBatchMonth} className="flex gap-2">
                      <input
                        type="hidden"
                        name="batchId"
                        value={batch.import_batch_id}
                      />

                      <input
                        type="month"
                        name="monthKey"
                        defaultValue={batch.month_key ?? ""}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        required
                      />

                      <button
                        type="submit"
                        className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Link
                      </button>
                    </form>

                    <form action={unlinkImportBatchMonth}>
                      <input
                        type="hidden"
                        name="batchId"
                        value={batch.import_batch_id}
                      />

                      <button
                        type="submit"
                        className="w-full rounded-xl bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        Unlink
                      </button>
                    </form>

                    <form action={deleteImportBatch}>
                      <input
                        type="hidden"
                        name="batchId"
                        value={batch.import_batch_id}
                      />
                      <input
                        type="hidden"
                        name="importType"
                        value={batch.import_type}
                      />

                      <button
                        type="submit"
                        className="w-full rounded-xl bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
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
      </CollapsibleSection>
    </PageLayout>
  );
}