import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getProviderDashboardMetrics,
  getProviderSnapshotsForNames,
  type ProviderDashboardModule,
  type ProviderMetricRow,
  type ProviderSnapshotCard,
} from "@/lib/providers/get-provider-dashboard-metrics";
import type { ProviderPeriodType } from "@/lib/providers/provider-periods";

type AdminProviderDashboardPageProps = {
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

type ProfileRow = {
  id: string;
  role: string;
  full_name: string | null;
};

const PERIODONTISTS = [
  "Dr Siobhan Gannon",
  "Dr Jenny Wang",
  "Dr Tom Briggs",
  "Dr Lisetta Lam",
  "Dr Troy McGowan",
];

const ORAL_MAXFAX_SURGEONS = [
  "Dr Benjamin Fu",
  "Dr Jae Heo",
  "Dr Jameel Kaderbhai",
  "Dr Omar Breik",
  "Dr William Huynh",
];

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

function clampPercentFraction(value: number | null | undefined): number {
  const safeValue = Number(value ?? 0);

  if (!Number.isFinite(safeValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, safeValue));
}

function clampPercentValue(value: number | null | undefined): number {
  const safeValue = Number(value ?? 0);

  if (!Number.isFinite(safeValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, safeValue));
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

function formatMonthNameFromKey(periodKey?: string | null): string {
  if (!periodKey) return "";
  const year = Number(getYearFromMonthKey(periodKey));
  const month = Number(getMonthFromMonthKey(periodKey));

  if (!year || !month) return periodKey;

  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

function buildMonthOptionsFromPeriodOptions(options: PeriodOption[]) {
  return options.map((option) => ({
    value: getMonthFromMonthKey(option.key),
    label: formatMonthNameFromKey(option.key),
  }));
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

  return `/admin/provider-dashboard?${search.toString()}`;
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

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
    </div>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function SimpleBarRow({
  label,
  value,
  maxValue,
  valueLabel,
}: {
  label: string;
  value: number;
  maxValue: number;
  valueLabel: string;
}) {
  const widthPercent = maxValue > 0 ? Math.max((value / maxValue) * 100, value > 0 ? 4 : 0) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-sm text-gray-500">{valueLabel}</div>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-100">
        <div
          className="h-3 rounded-full bg-gray-900"
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}

function PercentBarRow({
  label,
  value,
  valueLabel,
  colorClassName = "bg-blue-600",
}: {
  label: string;
  value: number;
  valueLabel: string;
  colorClassName?: string;
}) {
  const widthPercent = clampPercentValue(value);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-sm text-gray-500">{valueLabel}</div>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-100">
        <div
          className={`h-3 rounded-full ${colorClassName}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}

function ComparisonTable({
  title,
  allValue,
  perioValue,
  omsValue,
  formatter,
}: {
  title: string;
  allValue: number;
  perioValue: number;
  omsValue: number;
  formatter: (value: number) => string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>

      <div className="px-5 py-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
            <div className="font-medium text-gray-900">All Providers</div>
            <div className="text-gray-700">{formatter(allValue)}</div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
            <div className="font-medium text-gray-900">Periodontists</div>
            <div className="text-gray-700">{formatter(perioValue)}</div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
            <div className="font-medium text-gray-900">
              Oral &amp; Maxillofacial Surgeons
            </div>
            <div className="text-gray-700">{formatter(omsValue)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderMiniVisual({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const width = clampPercentValue(value);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className="text-xs text-gray-500">{value.toFixed(1)}%</div>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-blue-600"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ProviderSnapshotCardView({
  snapshot,
  module,
}: {
  snapshot: ProviderSnapshotCard;
  module: ProviderDashboardModule;
}) {
  const metric = snapshot.metric;

  if (!metric) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">{snapshot.provider.name}</div>
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          No data for this period
        </div>
      </div>
    );
  }

  if (module === "clinical") {
    const cancelPct = clampPercentFraction(metric.cancel_no_rebook_pct) * 100;
    const ftaPct = clampPercentFraction(metric.fta_pct) * 100;
    const consultPct = clampPercentFraction(metric.consult_rebooking_rate) * 100;

    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">{snapshot.provider.name}</div>
            {snapshot.provider.specialty ? (
              <div className="mt-1 text-xs text-gray-500">{snapshot.provider.specialty}</div>
            ) : null}
          </div>
          <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            Clinical
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Appointments</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {metric.total_appointments}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Conversion Rate</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {formatPercent(metric.consult_rebooking_rate)}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <ProviderMiniVisual label="Cancellation" value={cancelPct} />
          <ProviderMiniVisual label="FTA" value={ftaPct} />
          <ProviderMiniVisual label="Conversion Rate" value={consultPct} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-gray-200 px-2 py-3">
            <div className="text-[11px] text-gray-500">Cancel</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {metric.cancel_no_rebook_count}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 px-2 py-3">
            <div className="text-[11px] text-gray-500">FTA</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {metric.fta_count}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 px-2 py-3">
            <div className="text-[11px] text-gray-500">Not converted</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {metric.consult_not_rebooked_count}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const production = Number(metric.production_total ?? 0);
  const appointed = Number(metric.hours_appointed ?? 0);
  const billed = Number(metric.hours_billed ?? 0);
  const ppa = Number(metric.production_per_hour_appointed ?? 0);
  const ppb = Number(metric.production_per_hour_billed ?? 0);
  const maxValue = Math.max(production, ppa, ppb, 1);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{snapshot.provider.name}</div>
          {snapshot.provider.specialty ? (
            <div className="mt-1 text-xs text-gray-500">{snapshot.provider.specialty}</div>
          ) : null}
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          Financial
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Production</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {formatCurrency(metric.production_total)}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Prod / billed hr</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {formatCurrency(metric.production_per_hour_billed)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <SimpleBarRow
          label="Production"
          value={production}
          maxValue={maxValue}
          valueLabel={formatCurrency(production)}
        />
        <SimpleBarRow
          label="Prod / appointed hr"
          value={ppa}
          maxValue={maxValue}
          valueLabel={formatCurrency(ppa)}
        />
        <SimpleBarRow
          label="Prod / billed hr"
          value={ppb}
          maxValue={maxValue}
          valueLabel={formatCurrency(ppb)}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl border border-gray-200 px-2 py-3">
          <div className="text-[11px] text-gray-500">Appointed</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">
            {formatHours(appointed)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 px-2 py-3">
          <div className="text-[11px] text-gray-500">Billed</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">
            {formatHours(billed)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderSnapshotGrid({
  title,
  snapshots,
  module,
}: {
  title: string;
  snapshots: ProviderSnapshotCard[];
  module: ProviderDashboardModule;
}) {
  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <div className="text-sm text-gray-500">{snapshots.length} providers</div>
      </div>

      {snapshots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          No providers found for this group.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshots.map((snapshot) => (
            <ProviderSnapshotCardView
              key={snapshot.provider.id}
              snapshot={snapshot}
              module={module}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClinicalGroupSection({
  title,
  subtitle,
  metric,
  snapshots,
}: {
  title: string;
  subtitle?: string;
  metric: ProviderMetricRow | null;
  snapshots: ProviderSnapshotCard[];
}) {
  if (!metric) {
    return (
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          No clinical data available for this period.
        </div>
        <ProviderSnapshotGrid title="Provider snapshots" snapshots={snapshots} module="clinical" />
      </section>
    );
  }

  const barValues = [
    {
      label: "Cancellation (no rebooking)",
      value: clampPercentFraction(metric.cancel_no_rebook_pct) * 100,
    },
    {
      label: "FTA",
      value: clampPercentFraction(metric.fta_pct) * 100,
    },
    {
      label: "Consultation Conversion Rate",
      value: clampPercentFraction(metric.consult_rebooking_rate) * 100,
    },
  ];

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <SectionHeading title={title} subtitle={subtitle} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total appointments"
          value={String(metric.total_appointments ?? 0)}
          subtitle={`${metric.period_start} to ${metric.period_end}`}
        />
        <MetricCard
          title="Cancellation %"
          value={formatPercent(metric.cancel_no_rebook_pct)}
          subtitle={`${metric.cancel_no_rebook_count} appointments`}
        />
        <MetricCard
          title="FTA %"
          value={formatPercent(metric.fta_pct)}
          subtitle={`${metric.fta_count} appointments`}
        />
        <MetricCard
          title="Consultation Conversion Rate"
          value={formatPercent(metric.consult_rebooking_rate)}
          subtitle={`${metric.consult_rebooked_count} converted of ${metric.consult_completed_count}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="text-base font-semibold text-gray-900">Clinical rate comparison</h3>
          <div className="mt-5 space-y-5">
            {barValues.map((item) => (
              <PercentBarRow
                key={item.label}
                label={item.label}
                value={item.value}
                valueLabel={`${item.value.toFixed(1)}%`}
              />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="text-base font-semibold text-gray-900">Clinical summary</h3>
          <div className="mt-4 grid gap-3">
            <SummaryStat
              label="Cancelled with no rebooking"
              value={String(metric.cancel_no_rebook_count ?? 0)}
            />
            <SummaryStat
              label="FTA count"
              value={String(metric.fta_count ?? 0)}
            />
            <SummaryStat
              label="Consults not converted"
              value={String(metric.consult_not_rebooked_count ?? 0)}
            />
            <SummaryStat
              label="Consults Converted"
              value={String(metric.consult_rebooked_count ?? 0)}
            />
          </div>
        </div>
      </div>

      <ProviderSnapshotGrid title="Provider snapshots" snapshots={snapshots} module="clinical" />
    </section>
  );
}

function FinancialGroupSection({
  title,
  subtitle,
  metric,
  snapshots,
}: {
  title: string;
  subtitle?: string;
  metric: ProviderMetricRow | null;
  snapshots: ProviderSnapshotCard[];
}) {
  if (!metric) {
    return (
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          No financial data available for this period.
        </div>
        <ProviderSnapshotGrid title="Provider snapshots" snapshots={snapshots} module="financial" />
      </section>
    );
  }

  const barValues = [
    {
      label: "Production",
      value: Number(metric.production_total ?? 0),
      labelText: formatCurrency(metric.production_total),
    },
    {
      label: "Appointed hours",
      value: Number(metric.hours_appointed ?? 0),
      labelText: formatHours(metric.hours_appointed),
    },
    {
      label: "Billed hours",
      value: Number(metric.hours_billed ?? 0),
      labelText: formatHours(metric.hours_billed),
    },
  ];

  const maxBarValue = Math.max(...barValues.map((item) => item.value), 1);

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <SectionHeading title={title} subtitle={subtitle} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Production"
          value={formatCurrency(metric.production_total)}
          subtitle={`${metric.period_start} to ${metric.period_end}`}
        />
        <MetricCard
          title="Appointed hours"
          value={formatHours(metric.hours_appointed)}
          subtitle="Aggregated group total"
        />
        <MetricCard
          title="Billed hours"
          value={formatHours(metric.hours_billed)}
          subtitle="Aggregated group total"
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
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="text-base font-semibold text-gray-900">Financial volume overview</h3>
          <div className="mt-5 space-y-5">
            {barValues.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={item.label}
                value={item.value}
                maxValue={maxBarValue}
                valueLabel={item.labelText}
              />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="text-base font-semibold text-gray-900">Financial summary</h3>
          <div className="mt-4 grid gap-3">
            <SummaryStat
              label="Production per appointed hour"
              value={formatCurrency(metric.production_per_hour_appointed)}
            />
            <SummaryStat
              label="Production per billed hour"
              value={formatCurrency(metric.production_per_hour_billed)}
            />
            <SummaryStat
              label="Production"
              value={formatCurrency(metric.production_total)}
            />
          </div>
        </div>
      </div>

      <ProviderSnapshotGrid title="Provider snapshots" snapshots={snapshots} module="financial" />
    </section>
  );
}

async function getAdminProfile() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(`Failed to get authenticated user: ${userError.message}`);
  }

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  return profile;
}

export default async function AdminProviderDashboardPage({
  searchParams,
}: AdminProviderDashboardPageProps) {
  const profile = await getAdminProfile();

  if (!profile || profile.role !== "admin") {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
            <h1 className="text-2xl font-semibold">Access denied</h1>
            <p className="mt-3 text-sm">
              You must be an admin user to view the all-providers dashboard.
            </p>
          </div>
        </div>
      </main>
    );
  }

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

  const allDashboard = await getProviderDashboardMetrics({
    module: requestedModule,
    periodType: requestedPeriodType,
    periodKey: requestedPeriodKey,
    scope: "all",
  });

  const perioDashboard = await getProviderDashboardMetrics({
    module: requestedModule,
    periodType: requestedPeriodType,
    periodKey: requestedPeriodKey,
    scope: "group",
    groupLabel: "Periodontists",
    providerNames: PERIODONTISTS,
  });

  const omsDashboard = await getProviderDashboardMetrics({
    module: requestedModule,
    periodType: requestedPeriodType,
    periodKey: requestedPeriodKey,
    scope: "group",
    groupLabel: "Oral & Maxillofacial Surgeons",
    providerNames: ORAL_MAXFAX_SURGEONS,
  });

  if (!allDashboard) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            <h1 className="text-2xl font-semibold">Dashboard unavailable</h1>
            <p className="mt-3 text-sm">
              We could not load the aggregated provider dashboard.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const { selectedModule, selectedPeriodType, selectedPeriodKey, periodOptions } = allDashboard;

  const [perioSnapshots, omsSnapshots] = await Promise.all([
    selectedPeriodKey
      ? getProviderSnapshotsForNames({
          periodType: selectedPeriodType,
          periodKey: selectedPeriodKey,
          providerNames: PERIODONTISTS,
        })
      : Promise.resolve([]),
    selectedPeriodKey
      ? getProviderSnapshotsForNames({
          periodType: selectedPeriodType,
          periodKey: selectedPeriodKey,
          providerNames: ORAL_MAXFAX_SURGEONS,
        })
      : Promise.resolve([]),
  ]);

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

  const allMetric = allDashboard.metric;
  const perioMetric = perioDashboard.metric;
  const omsMetric = omsDashboard.metric;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">
                Admin Reporting
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                Provider Group Dashboard
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                Compare all providers, periodontists, and oral &amp; maxillofacial surgeons
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <Link
                href="/admin/provider-imports"
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                Upload Provider Appointments and Performance Data
              </Link>

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
                  options={buildMonthOptionsFromPeriodOptions(monthsForSelectedYear)}
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

        <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeading
            title="Group comparison table"
            subtitle="Quick comparison of the three reporting groups for the selected period"
          />

          {selectedModule === "clinical" ? (
            <div className="grid gap-4 xl:grid-cols-3">
              <ComparisonTable
                title="Total appointments"
                allValue={Number(allMetric?.total_appointments ?? 0)}
                perioValue={Number(perioMetric?.total_appointments ?? 0)}
                omsValue={Number(omsMetric?.total_appointments ?? 0)}
                formatter={(value) => String(value)}
              />
              <ComparisonTable
                title="FTA %"
                allValue={Number(allMetric?.fta_pct ?? 0)}
                perioValue={Number(perioMetric?.fta_pct ?? 0)}
                omsValue={Number(omsMetric?.fta_pct ?? 0)}
                formatter={(value) => `${(value * 100).toFixed(1)}%`}
              />
              <ComparisonTable
                title="Consultation Conversion Rate"
                allValue={Number(allMetric?.consult_rebooking_rate ?? 0)}
                perioValue={Number(perioMetric?.consult_rebooking_rate ?? 0)}
                omsValue={Number(omsMetric?.consult_rebooking_rate ?? 0)}
                formatter={(value) => `${(value * 100).toFixed(1)}%`}
              />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              <ComparisonTable
                title="Production"
                allValue={Number(allMetric?.production_total ?? 0)}
                perioValue={Number(perioMetric?.production_total ?? 0)}
                omsValue={Number(omsMetric?.production_total ?? 0)}
                formatter={(value) => formatCurrency(value)}
              />
              <ComparisonTable
                title="Production per appointed hour"
                allValue={Number(allMetric?.production_per_hour_appointed ?? 0)}
                perioValue={Number(perioMetric?.production_per_hour_appointed ?? 0)}
                omsValue={Number(omsMetric?.production_per_hour_appointed ?? 0)}
                formatter={(value) => formatCurrency(value)}
              />
              <ComparisonTable
                title="Production per billed hour"
                allValue={Number(allMetric?.production_per_hour_billed ?? 0)}
                perioValue={Number(perioMetric?.production_per_hour_billed ?? 0)}
                omsValue={Number(omsMetric?.production_per_hour_billed ?? 0)}
                formatter={(value) => formatCurrency(value)}
              />
            </div>
          )}
        </section>

        <div className="mt-6 space-y-6">
          {selectedModule === "clinical" ? (
            <>
              <ClinicalGroupSection
                title="All Providers"
                subtitle="Combined results across all clinicians"
                metric={allMetric}
                snapshots={[...perioSnapshots, ...omsSnapshots].sort((a, b) =>
                  a.provider.name.localeCompare(b.provider.name)
                )}
              />
              <ClinicalGroupSection
                title="Periodontists"
                subtitle={PERIODONTISTS.join(", ")}
                metric={perioMetric}
                snapshots={perioSnapshots}
              />
              <ClinicalGroupSection
                title="Oral & Maxillofacial Surgeons"
                subtitle={ORAL_MAXFAX_SURGEONS.join(", ")}
                metric={omsMetric}
                snapshots={omsSnapshots}
              />
            </>
          ) : (
            <>
              <FinancialGroupSection
                title="All Providers"
                subtitle="Combined results across all clinicians"
                metric={allMetric}
                snapshots={[...perioSnapshots, ...omsSnapshots].sort((a, b) =>
                  a.provider.name.localeCompare(b.provider.name)
                )}
              />
              <FinancialGroupSection
                title="Periodontists"
                subtitle={PERIODONTISTS.join(", ")}
                metric={perioMetric}
                snapshots={perioSnapshots}
              />
              <FinancialGroupSection
                title="Oral & Maxillofacial Surgeons"
                subtitle={ORAL_MAXFAX_SURGEONS.join(", ")}
                metric={omsMetric}
                snapshots={omsSnapshots}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}