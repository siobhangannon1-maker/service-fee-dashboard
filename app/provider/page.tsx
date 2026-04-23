import Link from "next/link";
import {
  getProviderDashboardMetrics,
  type ProviderDashboardModule,
} from "@/lib/providers/get-provider-dashboard-metrics";
import type { ProviderPeriodType } from "@/lib/providers/provider-periods";

type ProviderPageProps = {
  searchParams?: Promise<{
    module?: string;
    periodType?: string;
    periodKey?: string;
    year?: string;
    month?: string;
  }>;
};

type PeriodOption = {
  key: string;
  label: string;
};

function formatPercent(value: number | null | undefined): string {
  const safeValue = Number(value ?? 0);
  return `${(safeValue * 100).toFixed(1)}%`;
}

function formatCurrency(value: number | null | undefined): string {
  const safeValue = Number(value ?? 0);

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(safeValue);
}

function formatHours(value: number | null | undefined): string {
  const safeValue = Number(value ?? 0);
  return `${safeValue.toFixed(2)} h`;
}

function getPreviousMonthKey(): string {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = previousMonth.getFullYear();
  const month = String(previousMonth.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function sortPeriodOptionsAscending(options: PeriodOption[]): PeriodOption[] {
  return [...options].sort((a, b) => a.key.localeCompare(b.key));
}

function getYearFromMonthKey(periodKey?: string | null): string {
  if (!periodKey) return "";
  return periodKey.slice(0, 4);
}

function getMonthFromMonthKey(periodKey?: string | null): string {
  if (!periodKey) return "";
  return periodKey.slice(5, 7);
}

function buildHref(params: {
  module: ProviderDashboardModule;
  periodType: ProviderPeriodType;
  periodKey?: string;
  year?: string;
  month?: string;
}) {
  const search = new URLSearchParams();

  search.set("module", params.module);
  search.set("periodType", params.periodType);

  if (params.periodType === "month") {
    if (params.year) {
      search.set("year", params.year);
    }
    if (params.month) {
      search.set("month", params.month);
    }
    if (params.periodKey) {
      search.set("periodKey", params.periodKey);
    }
  } else if (params.periodKey) {
    search.set("periodKey", params.periodKey);
  }

  return `/provider?${search.toString()}`;
}

function ModuleTab({
  isActive,
  href,
  label,
}: {
  isActive: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition",
        isActive
          ? "bg-gray-900 text-white shadow-sm"
          : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function SegmentTab({
  isActive,
  href,
  label,
}: {
  isActive: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition",
        isActive
          ? "bg-blue-600 text-white shadow-sm"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{value}</div>
      {subtitle ? <div className="mt-2 text-sm text-gray-500">{subtitle}</div> : null}
    </div>
  );
}

function SpecialtyAverageCard({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold tracking-tight text-gray-900">{title}</div>
          <div className="mt-1 text-xs text-gray-500">{subtitle}</div>
        </div>

        <div className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-blue-700">
          Benchmark
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3"
          >
            <div className="text-sm text-gray-600">{item.label}</div>
            <div className="text-sm font-semibold text-gray-900">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-gray-700">{label}</div>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={`${name}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatBenchmarkPeriodLabel(metric: {
  period_start?: string | null;
  period_end?: string | null;
} | null): string {
  if (!metric?.period_start || !metric?.period_end) {
    return "Selected period";
  }

  return `${metric.period_start} to ${metric.period_end}`;
}

export default async function ProviderPage({ searchParams }: ProviderPageProps) {
  const resolvedSearchParams = await searchParams;

  const requestedModule =
    (resolvedSearchParams?.module as ProviderDashboardModule | undefined) ?? "clinical";
  const requestedPeriodType =
    (resolvedSearchParams?.periodType as ProviderPeriodType | undefined) ?? "month";

  const previousMonthKey = getPreviousMonthKey();
  const fallbackYear = getYearFromMonthKey(previousMonthKey);
  const fallbackMonth = getMonthFromMonthKey(previousMonthKey);

  const requestedYear = resolvedSearchParams?.year ?? fallbackYear;
  const requestedMonth = resolvedSearchParams?.month ?? fallbackMonth;

  const requestedPeriodKey =
    requestedPeriodType === "month"
      ? `${requestedYear}-${requestedMonth}`
      : (resolvedSearchParams?.periodKey ?? null);

  const dashboard = await getProviderDashboardMetrics({
    module: requestedModule,
    periodType: requestedPeriodType,
    periodKey: requestedPeriodKey,
  });

  if (!dashboard) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            <h1 className="text-2xl font-semibold">Provider dashboard unavailable</h1>
            <p className="mt-3 text-sm">
              We could not find a provider record linked to your current login.
            </p>
            <div className="mt-4 text-sm">
              Please check that:
              <br />
              1. you are logged in
              <br />
              2. your provider row has a <code>user_id</code> value
              <br />
              3. that <code>user_id</code> matches your Supabase auth user ID
            </div>
          </div>
        </div>
      </main>
    );
  }

  const {
    provider,
    selectedModule,
    selectedPeriodType,
    selectedPeriodKey,
    periodOptions,
    metric,
    specialtyAverages,
  } = dashboard as typeof dashboard & {
    specialtyAverages?: {
      specialtyLabel: string | null;
      clinical: {
        cancel_no_rebook_pct: number | null;
        fta_pct: number | null;
        consult_rebooking_rate: number | null;
      } | null;
      financial: {
        production_total: number | null;
        production_per_hour_appointed: number | null;
        production_per_hour_billed: number | null;
      } | null;
    } | null;
  };

  const monthOptionsAscending = sortPeriodOptionsAscending(periodOptions.month);
  const yearOptionsAscending = sortPeriodOptionsAscending(periodOptions.year);
  const quarterOptionsAscending = sortPeriodOptionsAscending(periodOptions.quarter_ato);

  const availableMonthYears = Array.from(
    new Set(monthOptionsAscending.map((option) => getYearFromMonthKey(option.key))),
  ).sort((a, b) => a.localeCompare(b));

  const selectedMonthYear =
    selectedPeriodType === "month"
      ? getYearFromMonthKey(selectedPeriodKey) || requestedYear
      : requestedYear;

  const monthsForSelectedYear = monthOptionsAscending.filter(
    (option) => getYearFromMonthKey(option.key) === selectedMonthYear,
  );

  const safeSelectedMonthKey =
    selectedPeriodType === "month" &&
    monthsForSelectedYear.some((option) => option.key === selectedPeriodKey)
      ? selectedPeriodKey
      : (monthsForSelectedYear[0]?.key ?? monthOptionsAscending[0]?.key ?? previousMonthKey);

  const safeSelectedMonthNumber = getMonthFromMonthKey(safeSelectedMonthKey);

  const periodLabel = formatBenchmarkPeriodLabel(metric);
  const specialtyLabel = specialtyAverages?.specialtyLabel ?? "Specialty group";

  const showClinicalSpecialtyAverages =
    selectedModule === "clinical" && Boolean(specialtyAverages?.clinical);

  const showFinancialSpecialtyAverages =
    selectedModule === "financial" && Boolean(specialtyAverages?.financial);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">
                Provider Performance
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                Provider Dashboard
              </h1>
              <p className="mt-2 text-sm text-gray-600">{provider.name}</p>
            </div>

            <div className="flex flex-wrap gap-2 rounded-2xl bg-gray-50 p-2 ring-1 ring-gray-200">
              <ModuleTab
                label="Clinical"
                isActive={selectedModule === "clinical"}
                href={buildHref({
                  module: "clinical",
                  periodType: selectedPeriodType,
                  periodKey: selectedPeriodType !== "month" ? selectedPeriodKey : undefined,
                  year: selectedPeriodType === "month" ? selectedMonthYear : undefined,
                  month: selectedPeriodType === "month" ? safeSelectedMonthNumber : undefined,
                })}
              />
              <ModuleTab
                label="Financial"
                isActive={selectedModule === "financial"}
                href={buildHref({
                  module: "financial",
                  periodType: selectedPeriodType,
                  periodKey: selectedPeriodType !== "month" ? selectedPeriodKey : undefined,
                  year: selectedPeriodType === "month" ? selectedMonthYear : undefined,
                  month: selectedPeriodType === "month" ? safeSelectedMonthNumber : undefined,
                })}
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Select the reporting view and period.
                </p>
              </div>

              <div className="inline-flex rounded-full bg-gray-100 p-1">
                <SegmentTab
                  label="Month"
                  isActive={selectedPeriodType === "month"}
                  href={buildHref({
                    module: selectedModule,
                    periodType: "month",
                    year: getYearFromMonthKey(previousMonthKey),
                    month: getMonthFromMonthKey(previousMonthKey),
                    periodKey: previousMonthKey,
                  })}
                />
                <SegmentTab
                  label="Year"
                  isActive={selectedPeriodType === "year"}
                  href={buildHref({
                    module: selectedModule,
                    periodType: "year",
                    periodKey: yearOptionsAscending[yearOptionsAscending.length - 1]?.key,
                  })}
                />
                <SegmentTab
                  label="ATO Quarter"
                  isActive={selectedPeriodType === "quarter_ato"}
                  href={buildHref({
                    module: selectedModule,
                    periodType: "quarter_ato",
                    periodKey: quarterOptionsAscending[quarterOptionsAscending.length - 1]?.key,
                  })}
                />
              </div>
            </div>

            {selectedPeriodType === "month" ? (
              <form method="get" className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <input type="hidden" name="module" value={selectedModule} />
                <input type="hidden" name="periodType" value="month" />

                <SelectField
                  label="Year"
                  name="year"
                  defaultValue={selectedMonthYear}
                  options={availableMonthYears.map((year) => ({
                    value: year,
                    label: year,
                  }))}
                />

                <SelectField
                  label="Month"
                  name="month"
                  defaultValue={safeSelectedMonthNumber}
                  options={monthsForSelectedYear.map((option) => ({
                    value: getMonthFromMonthKey(option.key),
                    label: option.label,
                  }))}
                />

                <button
                  type="submit"
                  className="inline-flex h-[44px] items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-black"
                >
                  Apply
                </button>
              </form>
            ) : null}

            {selectedPeriodType === "year" ? (
              <form method="get" className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <input type="hidden" name="module" value={selectedModule} />
                <input type="hidden" name="periodType" value="year" />

                <SelectField
                  label="Year"
                  name="periodKey"
                  defaultValue={selectedPeriodKey}
                  options={yearOptionsAscending.map((option) => ({
                    value: option.key,
                    label: option.label,
                  }))}
                />

                <button
                  type="submit"
                  className="inline-flex h-[44px] items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-black"
                >
                  Apply
                </button>
              </form>
            ) : null}

            {selectedPeriodType === "quarter_ato" ? (
              <form method="get" className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <input type="hidden" name="module" value={selectedModule} />
                <input type="hidden" name="periodType" value="quarter_ato" />

                <SelectField
                  label="ATO Quarter"
                  name="periodKey"
                  defaultValue={selectedPeriodKey}
                  options={quarterOptionsAscending.map((option) => ({
                    value: option.key,
                    label: option.label,
                  }))}
                />

                <button
                  type="submit"
                  className="inline-flex h-[44px] items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-black"
                >
                  Apply
                </button>
              </form>
            ) : null}
          </div>
        </section>

        {!metric ? (
          <section className="mt-6 rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-sm text-gray-600 shadow-sm">
            No metrics are available for the selected period yet.
          </section>
        ) : null}

        {metric && selectedModule === "clinical" ? (
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Cancellation (no rebooking) %"
              value={formatPercent(metric.cancel_no_rebook_pct)}
              subtitle={`${metric.cancel_no_rebook_count} of ${metric.total_appointments} appointments`}
            />
            <MetricCard
              title="Cancellation (no rebooking) number"
              value={String(metric.cancel_no_rebook_count)}
              subtitle="Cancelled appointments with no following appointment"
            />
            <MetricCard
              title="FTA %"
              value={formatPercent(metric.fta_pct)}
              subtitle={`${metric.fta_count} FTAs`}
            />
            <MetricCard
              title="FTA number"
              value={String(metric.fta_count)}
              subtitle="Appointments marked as FTA"
            />
            <MetricCard
              title="Consultation rebooking rate"
              value={formatPercent(metric.consult_rebooking_rate)}
              subtitle={`${metric.consult_rebooked_count} rebooked of ${metric.consult_completed_count} completed consultations`}
            />
            <MetricCard
              title="Consultations not rebooked"
              value={String(metric.consult_not_rebooked_count)}
              subtitle="Completed consultations without a following appointment"
            />
            <MetricCard
              title="Total appointments"
              value={String(metric.total_appointments)}
              subtitle={`${metric.period_start} to ${metric.period_end}`}
            />
          </section>
        ) : null}

        {metric && selectedModule === "financial" ? (
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Production"
              value={formatCurrency(metric.production_total)}
              subtitle={`${metric.period_start} to ${metric.period_end}`}
            />
            <MetricCard
              title="Appointed hours"
              value={formatHours(metric.hours_appointed)}
              subtitle="From provider performance import"
            />
            <MetricCard
              title="Billed hours"
              value={formatHours(metric.hours_billed)}
              subtitle="From provider performance import"
            />
            <MetricCard
              title="Production per appointed hour"
              value={formatCurrency(metric.production_per_hour_appointed)}
              subtitle="Production ÷ appointed hours"
            />
            <MetricCard
              title="Production per billed hour"
              value={formatCurrency(metric.production_per_hour_billed)}
              subtitle="Production ÷ billed hours"
            />
          </section>
        ) : null}

        {(showClinicalSpecialtyAverages || showFinancialSpecialtyAverages) && (
          <section className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                  Specialty averages
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Compare this provider against average results for {specialtyLabel}.
                </p>
              </div>

              <div className="text-xs text-gray-500">{periodLabel}</div>
            </div>

            <div className="mt-5 grid gap-4">
              {showClinicalSpecialtyAverages ? (
                <SpecialtyAverageCard
                  title={`Average Clinical Metrics for ${specialtyLabel}`}
                  subtitle={periodLabel}
                  items={[
                    {
                      label: "Cancellation (no rebooking) %",
                      value: formatPercent(specialtyAverages?.clinical?.cancel_no_rebook_pct),
                    },
                    {
                      label: "FTA %",
                      value: formatPercent(specialtyAverages?.clinical?.fta_pct),
                    },
                    {
                      label: "Consultation rebooking rate",
                      value: formatPercent(specialtyAverages?.clinical?.consult_rebooking_rate),
                    },
                  ]}
                />
              ) : null}

              {showFinancialSpecialtyAverages ? (
                <SpecialtyAverageCard
                  title={`Average Financial Metrics for ${specialtyLabel}`}
                  subtitle={periodLabel}
                  items={[
                    {
                      label: "Production",
                      value: formatCurrency(specialtyAverages?.financial?.production_total),
                    },
                    {
                      label: "Production per appointed hour",
                      value: formatCurrency(
                        specialtyAverages?.financial?.production_per_hour_appointed
                      ),
                    },
                    {
                      label: "Production per billed hour",
                      value: formatCurrency(
                        specialtyAverages?.financial?.production_per_hour_billed
                      ),
                    },
                  ]}
                />
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}