import {
  formatAtoQuarterLabel,
  getCurrentMonthKey,
  type ProviderPeriodType,
} from "./provider-periods";
import { createClient } from "@/lib/supabase/server";

type ProviderRow = {
  id: string;
  name: string | null;
  email?: string | null;
  user_id: string | null;
  specialty?: string | null;
};

export type ProviderMetricRow = {
  provider_id: string;
  period_type: ProviderPeriodType;
  period_key: string;
  period_start: string;
  period_end: string;

  total_appointments: number;

  cancel_no_rebook_count: number;
  cancel_no_rebook_pct: number;

  fta_count: number;
  fta_pct: number;

  consult_completed_count: number;
  consult_not_rebooked_count: number;
  consult_rebooked_count: number;
  consult_rebooking_rate: number;

  gap_hours: number;
  gap_pct: number;

  production_total: number;
  hours_appointed: number;
  hours_billed: number;
  production_per_hour_appointed: number;
  production_per_hour_billed: number;
};

type ProfileRow = {
  id: string;
  role: string;
};

export type ProviderDashboardModule = "clinical" | "financial";
export type ProviderDashboardScope = "self" | "all" | "group";

export type ProviderDashboardPeriodOption = {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type ProviderSpecialtyAverages = {
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
};

export type ProviderDashboardData = {
  provider: {
    id: string;
    name: string;
    specialty?: string | null;
  };
  selectedModule: ProviderDashboardModule;
  selectedPeriodType: ProviderPeriodType;
  selectedPeriodKey: string;
  metric: ProviderMetricRow | null;
  periodOptions: {
    month: ProviderDashboardPeriodOption[];
    year: ProviderDashboardPeriodOption[];
    quarter_ato: ProviderDashboardPeriodOption[];
  };
  specialtyAverages?: ProviderSpecialtyAverages | null;
};

export type ProviderSnapshotCard = {
  provider: {
    id: string;
    name: string;
    specialty?: string | null;
  };
  metric: ProviderMetricRow | null;
};

function isValidModule(value: string | null | undefined): value is ProviderDashboardModule {
  return value === "clinical" || value === "financial";
}

function isValidPeriodType(value: string | null | undefined): value is ProviderPeriodType {
  return value === "month" || value === "year" || value === "quarter_ato";
}

function formatMonthLabel(periodKey: string): string {
  const [yearText, monthText] = periodKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) return periodKey;

  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

function formatPeriodLabel(periodType: ProviderPeriodType, periodKey: string): string {
  if (periodType === "month") return formatMonthLabel(periodKey);
  if (periodType === "year") return periodKey;
  return formatAtoQuarterLabel(periodKey);
}

function dedupeAndSortPeriods(
  rows: Array<Pick<ProviderMetricRow, "period_key" | "period_start" | "period_end">>,
  periodType: ProviderPeriodType
): ProviderDashboardPeriodOption[] {
  const map = new Map<string, ProviderDashboardPeriodOption>();

  for (const row of rows) {
    if (!map.has(row.period_key)) {
      map.set(row.period_key, {
        key: row.period_key,
        label: formatPeriodLabel(periodType, row.period_key),
        start: row.period_start,
        end: row.period_end,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.start.localeCompare(b.start));
}

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

function aggregateProviderMetricRows(rows: ProviderMetricRow[]): ProviderMetricRow | null {
  if (!rows || rows.length === 0) return null;

  const firstRow = rows[0];

  const totalAppointments = rows.reduce((sum, row) => sum + toNumber(row.total_appointments), 0);

  const cancelNoRebookCount = rows.reduce(
    (sum, row) => sum + toNumber(row.cancel_no_rebook_count),
    0
  );

  const ftaCount = rows.reduce((sum, row) => sum + toNumber(row.fta_count), 0);

  const consultCompletedCount = rows.reduce(
    (sum, row) => sum + toNumber(row.consult_completed_count),
    0
  );

  const consultNotRebookedCount = rows.reduce(
    (sum, row) => sum + toNumber(row.consult_not_rebooked_count),
    0
  );

  const consultRebookedCount = rows.reduce(
    (sum, row) => sum + toNumber(row.consult_rebooked_count),
    0
  );

  // gap_hours now represents scheduled - billed
  const gapHours = rows.reduce((sum, row) => sum + toNumber(row.gap_hours), 0);

  const productionTotal = rows.reduce((sum, row) => sum + toNumber(row.production_total), 0);

  const hoursAppointed = rows.reduce((sum, row) => sum + toNumber(row.hours_appointed), 0);

  const hoursBilled = rows.reduce((sum, row) => sum + toNumber(row.hours_billed), 0);

  const hoursScheduled = gapHours + hoursBilled;
  const gapPct = safeDivide(gapHours, hoursScheduled);

  return {
    provider_id: "aggregated",
    period_type: firstRow.period_type,
    period_key: firstRow.period_key,
    period_start: firstRow.period_start,
    period_end: firstRow.period_end,

    total_appointments: totalAppointments,

    cancel_no_rebook_count: cancelNoRebookCount,
    cancel_no_rebook_pct: safeDivide(cancelNoRebookCount, totalAppointments),

    fta_count: ftaCount,
    fta_pct: safeDivide(ftaCount, totalAppointments),

    consult_completed_count: consultCompletedCount,
    consult_not_rebooked_count: consultNotRebookedCount,
    consult_rebooked_count: consultRebookedCount,
    consult_rebooking_rate: safeDivide(consultRebookedCount, consultCompletedCount),

    gap_hours: gapHours,
    gap_pct: gapPct,

    production_total: productionTotal,
    hours_appointed: hoursAppointed,
    hours_billed: hoursBilled,
    production_per_hour_appointed: safeDivide(productionTotal, hoursAppointed),
    production_per_hour_billed: safeDivide(productionTotal, hoursBilled),
  };
}

function normalizeSpecialtyGroup(specialty: string | null | undefined): string | null {
  const normalized = (specialty ?? "").trim().toLowerCase();

  if (!normalized) return null;

  if (
    normalized.includes("periodontist") ||
    normalized.includes("periodontics") ||
    normalized === "perio"
  ) {
    return "Periodontists";
  }

  if (
    normalized.includes("oral and maxillofacial") ||
    normalized.includes("oral & maxillofacial") ||
    normalized.includes("oral surgeon") ||
    normalized.includes("maxillofacial")
  ) {
    return "Oral and Maxillofacial Surgeons";
  }

  return null;
}

async function getAuthenticatedUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(`Failed to get authenticated user: ${error.message}`);
  }

  if (!user) {
    throw new Error("No authenticated user found for this session.");
  }

  return { supabase, user };
}

async function getProfileRole(userId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new Error(`Failed to load user profile: ${error.message}`);
  }

  return data?.role ?? null;
}

async function requireAdmin(userId: string) {
  const role = await getProfileRole(userId);

  if (role !== "admin") {
    throw new Error("Access denied. Admin role is required.");
  }
}

async function getProvidersByNames(names: string[]): Promise<ProviderRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("providers")
    .select("id, name, email, user_id, specialty")
    .in("name", names);

  if (error) {
    throw new Error(`Failed to load provider group: ${error.message}`);
  }

  const rows = ((data ?? []) as ProviderRow[]).sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "")
  );

  return rows;
}

async function getSpecialtyAveragesForProvider(params: {
  provider: ProviderRow | null;
  selectedPeriodType: ProviderPeriodType;
  selectedPeriodKey: string;
}): Promise<ProviderSpecialtyAverages | null> {
  const specialtyLabel = normalizeSpecialtyGroup(params.provider?.specialty);

  if (!specialtyLabel || !params.selectedPeriodKey) {
    return null;
  }

  const supabase = await createClient();

  const { data: specialtyProviders, error: providersError } = await supabase
    .from("providers")
    .select("id, specialty")
    .not("id", "is", null);

  if (providersError) {
    throw new Error(`Failed to load specialty providers: ${providersError.message}`);
  }

  const matchingProviderIds = ((specialtyProviders ?? []) as ProviderRow[])
    .filter((row) => normalizeSpecialtyGroup(row.specialty) === specialtyLabel)
    .map((row) => row.id);

  if (matchingProviderIds.length === 0) {
    return {
      specialtyLabel,
      clinical: null,
      financial: null,
    };
  }

  const { data: metricRows, error: metricsError } = await supabase
    .from("provider_period_metrics")
    .select(
      `
      provider_id,
      period_type,
      period_key,
      period_start,
      period_end,
      total_appointments,
      cancel_no_rebook_count,
      cancel_no_rebook_pct,
      fta_count,
      fta_pct,
      consult_completed_count,
      consult_not_rebooked_count,
      consult_rebooked_count,
      consult_rebooking_rate,
      gap_hours,
      gap_pct,
      production_total,
      hours_appointed,
      hours_billed,
      production_per_hour_appointed,
      production_per_hour_billed
      `
    )
    .eq("period_type", params.selectedPeriodType)
    .eq("period_key", params.selectedPeriodKey)
    .in("provider_id", matchingProviderIds);

  if (metricsError) {
    throw new Error(`Failed to load specialty averages: ${metricsError.message}`);
  }

  const rows = (metricRows ?? []) as ProviderMetricRow[];

  if (rows.length === 0) {
    return {
      specialtyLabel,
      clinical: null,
      financial: null,
    };
  }

  const providerCount = rows.length;

  const clinical = {
    cancel_no_rebook_pct:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.cancel_no_rebook_pct), 0) / providerCount
        : null,
    fta_pct:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.fta_pct), 0) / providerCount
        : null,
    consult_rebooking_rate:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.consult_rebooking_rate), 0) / providerCount
        : null,
  };

  const financial = {
    production_total:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.production_total), 0) / providerCount
        : null,
    production_per_hour_appointed:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.production_per_hour_appointed), 0) /
          providerCount
        : null,
    production_per_hour_billed:
      providerCount > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.production_per_hour_billed), 0) /
          providerCount
        : null,
  };

  return {
    specialtyLabel,
    clinical,
    financial,
  };
}

export async function getProviderDashboardMetrics(params?: {
  module?: string | null;
  periodType?: string | null;
  periodKey?: string | null;
  scope?: ProviderDashboardScope;
  providerNames?: string[];
  groupLabel?: string;
}): Promise<ProviderDashboardData | null> {
  const { supabase, user } = await getAuthenticatedUser();

  const selectedModule: ProviderDashboardModule = isValidModule(params?.module)
    ? params.module
    : "clinical";

  const selectedPeriodType: ProviderPeriodType = isValidPeriodType(params?.periodType)
    ? params.periodType
    : "month";

  const scope: ProviderDashboardScope =
    params?.scope === "group" ? "group" : params?.scope === "all" ? "all" : "self";

  let provider: ProviderRow | null = null;
  let providerIdsForGroup: string[] = [];

  if (scope === "self") {
    const { data: providerRow, error: providerError } = await supabase
      .from("providers")
      .select("id, name, email, user_id, specialty")
      .eq("user_id", user.id)
      .maybeSingle<ProviderRow>();

    if (providerError) {
      throw new Error(`Failed to load provider for user: ${providerError.message}`);
    }

    if (!providerRow) {
      return null;
    }

    provider = providerRow;
  }

  if (scope === "all" || scope === "group") {
    await requireAdmin(user.id);
  }

  if (scope === "group") {
    const providerNames = params?.providerNames ?? [];

    if (providerNames.length === 0) {
      throw new Error("Group dashboard requires providerNames.");
    }

    const groupProviders = await getProvidersByNames(providerNames);
    providerIdsForGroup = groupProviders.map((row) => row.id);

    if (providerIdsForGroup.length === 0) {
      return {
        provider: {
          id: "group-empty",
          name: params?.groupLabel ?? "Provider Group",
          specialty: null,
        },
        selectedModule,
        selectedPeriodType,
        selectedPeriodKey: "",
        metric: null,
        periodOptions: {
          month: [],
          year: [],
          quarter_ato: [],
        },
        specialtyAverages: null,
      };
    }
  }

  let monthQuery = supabase
    .from("provider_period_metrics")
    .select("period_key, period_start, period_end")
    .eq("period_type", "month")
    .order("period_start", { ascending: true });

  let yearQuery = supabase
    .from("provider_period_metrics")
    .select("period_key, period_start, period_end")
    .eq("period_type", "year")
    .order("period_start", { ascending: true });

  let quarterQuery = supabase
    .from("provider_period_metrics")
    .select("period_key, period_start, period_end")
    .eq("period_type", "quarter_ato")
    .order("period_start", { ascending: true });

  if (scope === "self" && provider) {
    monthQuery = monthQuery.eq("provider_id", provider.id);
    yearQuery = yearQuery.eq("provider_id", provider.id);
    quarterQuery = quarterQuery.eq("provider_id", provider.id);
  }

  if (scope === "group") {
    monthQuery = monthQuery.in("provider_id", providerIdsForGroup);
    yearQuery = yearQuery.in("provider_id", providerIdsForGroup);
    quarterQuery = quarterQuery.in("provider_id", providerIdsForGroup);
  }

  const [
    { data: monthRows, error: monthRowsError },
    { data: yearRows, error: yearRowsError },
    { data: quarterRows, error: quarterRowsError },
  ] = await Promise.all([monthQuery, yearQuery, quarterQuery]);

  if (monthRowsError) {
    throw new Error(`Failed to load monthly period options: ${monthRowsError.message}`);
  }

  if (yearRowsError) {
    throw new Error(`Failed to load yearly period options: ${yearRowsError.message}`);
  }

  if (quarterRowsError) {
    throw new Error(`Failed to load quarter period options: ${quarterRowsError.message}`);
  }

  const periodOptions = {
    month: dedupeAndSortPeriods(
      (monthRows ?? []) as Array<
        Pick<ProviderMetricRow, "period_key" | "period_start" | "period_end">
      >,
      "month"
    ),
    year: dedupeAndSortPeriods(
      (yearRows ?? []) as Array<
        Pick<ProviderMetricRow, "period_key" | "period_start" | "period_end">
      >,
      "year"
    ),
    quarter_ato: dedupeAndSortPeriods(
      (quarterRows ?? []) as Array<
        Pick<ProviderMetricRow, "period_key" | "period_start" | "period_end">
      >,
      "quarter_ato"
    ),
  };

  let selectedPeriodKey = params?.periodKey?.trim() ?? "";

  if (!selectedPeriodKey) {
    if (selectedPeriodType === "month") {
      const currentMonthKey = getCurrentMonthKey();
      const hasCurrentMonth = periodOptions.month.some((option) => option.key === currentMonthKey);

      if (hasCurrentMonth) {
        selectedPeriodKey = currentMonthKey;
      } else if (periodOptions.month.length > 0) {
        selectedPeriodKey = periodOptions.month[periodOptions.month.length - 1].key;
      }
    }

    if (selectedPeriodType === "year" && periodOptions.year.length > 0) {
      selectedPeriodKey = periodOptions.year[periodOptions.year.length - 1].key;
    }

    if (selectedPeriodType === "quarter_ato" && periodOptions.quarter_ato.length > 0) {
      selectedPeriodKey = periodOptions.quarter_ato[periodOptions.quarter_ato.length - 1].key;
    }
  }

  const activeOptions = periodOptions[selectedPeriodType];
  const selectedExists = activeOptions.some((option) => option.key === selectedPeriodKey);

  if (!selectedExists && activeOptions.length > 0) {
    selectedPeriodKey = activeOptions[activeOptions.length - 1].key;
  }

  let metric: ProviderMetricRow | null = null;

  if (selectedPeriodKey) {
    let metricQuery = supabase
      .from("provider_period_metrics")
      .select(
        `
        provider_id,
        period_type,
        period_key,
        period_start,
        period_end,
        total_appointments,
        cancel_no_rebook_count,
        cancel_no_rebook_pct,
        fta_count,
        fta_pct,
        consult_completed_count,
        consult_not_rebooked_count,
        consult_rebooked_count,
        consult_rebooking_rate,
        gap_hours,
        gap_pct,
        production_total,
        hours_appointed,
        hours_billed,
        production_per_hour_appointed,
        production_per_hour_billed
        `
      )
      .eq("period_type", selectedPeriodType)
      .eq("period_key", selectedPeriodKey);

    if (scope === "self" && provider) {
      const { data: metricRow, error: metricError } = await metricQuery
        .eq("provider_id", provider.id)
        .maybeSingle<ProviderMetricRow>();

      if (metricError) {
        throw new Error(`Failed to load provider dashboard metric: ${metricError.message}`);
      }

      metric = metricRow;
    }

    if (scope === "all") {
      const { data: metricRows, error: metricError } = await metricQuery;

      if (metricError) {
        throw new Error(`Failed to load admin dashboard metrics: ${metricError.message}`);
      }

      metric = aggregateProviderMetricRows((metricRows ?? []) as ProviderMetricRow[]);
    }

    if (scope === "group") {
      const { data: metricRows, error: metricError } = await metricQuery.in(
        "provider_id",
        providerIdsForGroup
      );

      if (metricError) {
        throw new Error(`Failed to load grouped dashboard metrics: ${metricError.message}`);
      }

      metric = aggregateProviderMetricRows((metricRows ?? []) as ProviderMetricRow[]);
    }
  }

  if (scope === "all") {
    return {
      provider: {
        id: "all-providers",
        name: "All Providers",
        specialty: null,
      },
      selectedModule,
      selectedPeriodType,
      selectedPeriodKey,
      metric,
      periodOptions,
      specialtyAverages: null,
    };
  }

  if (scope === "group") {
    return {
      provider: {
        id: "provider-group",
        name: params?.groupLabel ?? "Provider Group",
        specialty: null,
      },
      selectedModule,
      selectedPeriodType,
      selectedPeriodKey,
      metric,
      periodOptions,
      specialtyAverages: null,
    };
  }

  const specialtyAverages = await getSpecialtyAveragesForProvider({
    provider,
    selectedPeriodType,
    selectedPeriodKey,
  });

  return {
    provider: {
      id: provider?.id ?? "",
      name: provider?.name ?? "Provider",
      specialty: provider?.specialty ?? null,
    },
    selectedModule,
    selectedPeriodType,
    selectedPeriodKey,
    metric,
    periodOptions,
    specialtyAverages,
  };
}

export async function getProviderSnapshotsForNames(params: {
  periodType: ProviderPeriodType;
  periodKey: string;
  providerNames: string[];
}): Promise<ProviderSnapshotCard[]> {
  const { supabase, user } = await getAuthenticatedUser();
  await requireAdmin(user.id);

  const providers = await getProvidersByNames(params.providerNames);

  if (providers.length === 0) return [];

  const providerIds = providers.map((provider) => provider.id);

  const { data: metricRows, error } = await supabase
    .from("provider_period_metrics")
    .select(
      `
      provider_id,
      period_type,
      period_key,
      period_start,
      period_end,
      total_appointments,
      cancel_no_rebook_count,
      cancel_no_rebook_pct,
      fta_count,
      fta_pct,
      consult_completed_count,
      consult_not_rebooked_count,
      consult_rebooked_count,
      consult_rebooking_rate,
      gap_hours,
      gap_pct,
      production_total,
      hours_appointed,
      hours_billed,
      production_per_hour_appointed,
      production_per_hour_billed
      `
    )
    .eq("period_type", params.periodType)
    .eq("period_key", params.periodKey)
    .in("provider_id", providerIds);

  if (error) {
    throw new Error(`Failed to load provider snapshots: ${error.message}`);
  }

  const metricsByProviderId = new Map<string, ProviderMetricRow>();

  for (const row of (metricRows ?? []) as ProviderMetricRow[]) {
    metricsByProviderId.set(row.provider_id, row);
  }

  return providers.map((provider) => ({
    provider: {
      id: provider.id,
      name: provider.name ?? "Provider",
      specialty: provider.specialty ?? null,
    },
    metric: metricsByProviderId.get(provider.id) ?? null,
  }));
}