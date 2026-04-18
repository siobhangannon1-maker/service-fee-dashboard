"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateServiceFee } from "@/lib/calculations";
import Toast from "@/components/ui/Toast";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type Provider = {
  id: string;
  name: string;
  specialty: string;
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: { up_to: number | null; rate: number }[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
};

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
  status: string;
};

type ProviderMonthlyRecord = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  gross_production: number;
  adjustments: number;
  incorrect_payments: number;
  iv_facility_fees: number;
  other_deductions?: number | null;
};

type PatientFinancialEntry = {
  id: string;
  provider_id: string;
  related_provider_id: string | null;
  billing_period_id: string | null;
  category:
    | "lab_implant_materials"
    | "fees_paid_to_focus"
    | "fees_paid_in_error"
    | "fees_owed"
    | "paid_to_wrong_provider";
  amount: number;
  deleted_at?: string | null;
};

type BillingDetailEntry = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  category: "humm_fee" | "afterpay_fee" | "incorrect_payment";
  amount: number;
  deleted_at?: string | null;
};

type AutoTotals = {
  labImplantMaterials: number;
  feesPaidToFocus: number;
  feesPaidInError: number;
  feesOwed: number;
  hummFees: number;
  afterpayFees: number;
};

type SummaryRow = {
  periodId: string;
  label: string;
  status: string;
  grossProduction: number;
  serviceFees: number;
  labMaterials: number;
  merchantFees: number;
  feesPaidToFocus: number;
  feesPaidInError: number;
  feesOwed: number;
  finalTotalDue: number;
};

type PeriodMode = "month" | "quarter";

type QuarterOption = {
  id: string;
  label: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  periodIds: string[];
};

function formatMoney(value: number) {
  return value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-AU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function calculateFeeBase(
  provider: Provider,
  record: ProviderMonthlyRecord,
  autoTotals: AutoTotals
) {
  return (
    Number(record.gross_production || 0) -
    (provider.deduct_adjustments ? Number(record.adjustments || 0) : 0) -
    autoTotals.hummFees -
    autoTotals.afterpayFees -
    (provider.deduct_iv_fees ? Number(record.iv_facility_fees || 0) : 0) -
    autoTotals.labImplantMaterials -
    Number(record.other_deductions || 0)
  );
}

function getStatusClasses(status: string) {
  if (status === "locked") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }
  return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
}

function getDeltaTone(value: number) {
  if (value > 0) return "text-emerald-700 bg-emerald-50";
  if (value < 0) return "text-rose-700 bg-rose-50";
  return "text-slate-600 bg-slate-100";
}

function MetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
      {subtext ? <div className="mt-2 text-xs text-slate-500">{subtext}</div> : null}
    </div>
  );
}

function getATOQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month >= 7 && month <= 9) return 1;
  if (month >= 10 && month <= 12) return 2;
  if (month >= 1 && month <= 3) return 3;
  return 4;
}

function getATOQuarterLabel(year: number, quarter: 1 | 2 | 3 | 4) {
  const fyYearShort = String((year + 1) % 100).padStart(2, "0");
  return `FY${fyYearShort} Q${quarter}`;
}

function emptyAutoTotals(): AutoTotals {
  return {
    labImplantMaterials: 0,
    feesPaidToFocus: 0,
    feesPaidInError: 0,
    feesOwed: 0,
    hummFees: 0,
    afterpayFees: 0,
  };
}

function emptySummaryRow(label = "No selection"): SummaryRow {
  return {
    periodId: "",
    label,
    status: "locked",
    grossProduction: 0,
    serviceFees: 0,
    labMaterials: 0,
    merchantFees: 0,
    feesPaidToFocus: 0,
    feesPaidInError: 0,
    feesOwed: 0,
    finalTotalDue: 0,
  };
}

export default function FinancialsClient() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [records, setRecords] = useState<ProviderMonthlyRecord[]>([]);
  const [patientEntries, setPatientEntries] = useState<PatientFinancialEntry[]>([]);
  const [detailEntries, setDetailEntries] = useState<BillingDetailEntry[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("all");
  const [selectedComparePeriodId, setSelectedComparePeriodId] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [selectedMonthPeriodId, setSelectedMonthPeriodId] = useState("");
  const [selectedQuarterId, setSelectedQuarterId] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(true);

  async function loadData(showSuccessMessage = false) {
    setLoading(true);

    const [providerRes, periodRes, recordRes, patientRes, detailRes] = await Promise.all([
      supabase.from("providers").select("*").order("name"),
      supabase
        .from("billing_periods")
        .select("*")
        .order("year", { ascending: false })
        .order("month", { ascending: false }),
      supabase.from("provider_monthly_records").select("*"),
      supabase.from("patient_financial_entries").select("*").is("deleted_at", null),
      supabase.from("billing_detail_entries").select("*").is("deleted_at", null),
    ]);

    if (providerRes.error) {
      setTone("error");
      setMessage(`Error loading providers: ${providerRes.error.message}`);
      setLoading(false);
      return;
    }
    if (periodRes.error) {
      setTone("error");
      setMessage(`Error loading periods: ${periodRes.error.message}`);
      setLoading(false);
      return;
    }
    if (recordRes.error) {
      setTone("error");
      setMessage(`Error loading records: ${recordRes.error.message}`);
      setLoading(false);
      return;
    }
    if (patientRes.error) {
      setTone("error");
      setMessage(`Error loading patient entries: ${patientRes.error.message}`);
      setLoading(false);
      return;
    }
    if (detailRes.error) {
      setTone("error");
      setMessage(`Error loading detail entries: ${detailRes.error.message}`);
      setLoading(false);
      return;
    }

    const loadedProviders = (providerRes.data || []) as Provider[];
    const loadedPeriods = (periodRes.data || []) as BillingPeriod[];

    setProviders(loadedProviders);
    setBillingPeriods(loadedPeriods);
    setRecords((recordRes.data || []) as ProviderMonthlyRecord[]);
    setPatientEntries((patientRes.data || []) as PatientFinancialEntry[]);
    setDetailEntries((detailRes.data || []) as BillingDetailEntry[]);

    if (!selectedComparePeriodId && loadedPeriods.length > 0) {
      setSelectedComparePeriodId(loadedPeriods[0].id);
    }

    if (!selectedMonthPeriodId && loadedPeriods.length > 0) {
      setSelectedMonthPeriodId(loadedPeriods[0].id);
    }

    if (showSuccessMessage) {
      setTone("success");
      setMessage("Dashboard refreshed successfully.");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ascendingBillingPeriods = useMemo(() => {
    return [...billingPeriods].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [billingPeriods]);

  const activeProviders = useMemo(() => {
    return selectedProviderId === "all"
      ? providers
      : providers.filter((p) => p.id === selectedProviderId);
  }, [providers, selectedProviderId]);

  const autoTotalsByProviderAndPeriod = useMemo(() => {
    const totals: Record<string, AutoTotals> = {};

    function key(providerId: string, periodId: string) {
      return `${providerId}__${periodId}`;
    }

    for (const entry of patientEntries) {
      if (!entry.billing_period_id) continue;
      const k = key(entry.provider_id, entry.billing_period_id);

      if (!totals[k]) totals[k] = emptyAutoTotals();

      const amount = Number(entry.amount || 0);

      if (entry.category === "lab_implant_materials") totals[k].labImplantMaterials += amount;
      if (entry.category === "fees_paid_to_focus") totals[k].feesPaidToFocus += amount;
      if (entry.category === "fees_paid_in_error") totals[k].feesPaidInError += amount;
      if (entry.category === "fees_owed") totals[k].feesOwed += amount;

      if (entry.category === "paid_to_wrong_provider") {
        totals[k].feesPaidInError += amount;

        if (entry.related_provider_id) {
          const owedKey = key(entry.related_provider_id, entry.billing_period_id);
          if (!totals[owedKey]) totals[owedKey] = emptyAutoTotals();
          totals[owedKey].feesOwed += amount;
        }
      }
    }

    for (const entry of detailEntries) {
      const k = key(entry.provider_id, entry.billing_period_id);
      if (!totals[k]) totals[k] = emptyAutoTotals();

      const amount = Number(entry.amount || 0);

      if (entry.category === "humm_fee") totals[k].hummFees += amount;
      if (entry.category === "afterpay_fee") totals[k].afterpayFees += amount;
    }

    return totals;
  }, [patientEntries, detailEntries]);

  const monthlySummary = useMemo<SummaryRow[]>(() => {
    return ascendingBillingPeriods.map((period) => {
      const periodRecords = records.filter(
        (record) =>
          record.billing_period_id === period.id &&
          (selectedProviderId === "all" || record.provider_id === selectedProviderId)
      );

      let grossProduction = 0;
      let serviceFees = 0;
      let labMaterials = 0;
      let merchantFees = 0;
      let feesPaidToFocus = 0;
      let feesPaidInError = 0;
      let feesOwed = 0;
      let finalTotalDue = 0;

      periodRecords.forEach((record) => {
        const provider = providers.find((p) => p.id === record.provider_id);
        if (!provider) return;

        const autoTotals =
          autoTotalsByProviderAndPeriod[`${record.provider_id}__${record.billing_period_id}`] ||
          emptyAutoTotals();

        const feeBase = calculateFeeBase(provider, record, autoTotals);
        const serviceFee = calculateServiceFee(provider, feeBase);
        const gst = serviceFee * 0.1;
        const totalFeesDue = serviceFee + gst;
        const feesAndCostsTotal =
          totalFeesDue + autoTotals.hummFees + autoTotals.labImplantMaterials;
        const providerFinalTotalDue =
          feesAndCostsTotal -
          autoTotals.feesPaidToFocus +
          autoTotals.feesOwed -
          autoTotals.feesPaidInError +
          Number(record.iv_facility_fees || 0);

        grossProduction += Number(record.gross_production || 0);
        serviceFees += serviceFee;
        labMaterials += autoTotals.labImplantMaterials;
        merchantFees += autoTotals.hummFees + autoTotals.afterpayFees;
        feesPaidToFocus += autoTotals.feesPaidToFocus;
        feesPaidInError += autoTotals.feesPaidInError;
        feesOwed += autoTotals.feesOwed;
        finalTotalDue += providerFinalTotalDue;
      });

      return {
        periodId: period.id,
        label: period.label,
        status: period.status,
        grossProduction,
        serviceFees,
        labMaterials,
        merchantFees,
        feesPaidToFocus,
        feesPaidInError,
        feesOwed,
        finalTotalDue,
      };
    });
  }, [
    ascendingBillingPeriods,
    records,
    providers,
    autoTotalsByProviderAndPeriod,
    selectedProviderId,
  ]);

  const quarterOptions = useMemo<QuarterOption[]>(() => {
    const grouped = new Map<string, QuarterOption>();

    ascendingBillingPeriods.forEach((period) => {
      const quarter = getATOQuarter(period.month);
      const baseYear = period.month >= 7 ? period.year : period.year - 1;
      const id = `${baseYear}-Q${quarter}`;

      if (!grouped.has(id)) {
        grouped.set(id, {
          id,
          label: getATOQuarterLabel(baseYear, quarter),
          year: baseYear,
          quarter,
          periodIds: [],
        });
      }

      grouped.get(id)!.periodIds.push(period.id);
    });

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.quarter - b.quarter;
    });
  }, [ascendingBillingPeriods]);

  useEffect(() => {
    if (!selectedQuarterId && quarterOptions.length > 0) {
      setSelectedQuarterId(quarterOptions[quarterOptions.length - 1].id);
    }
  }, [quarterOptions, selectedQuarterId]);

  const quarterlySummary = useMemo<SummaryRow[]>(() => {
    return quarterOptions.map((quarter) => {
      const rows = monthlySummary.filter((row) => quarter.periodIds.includes(row.periodId));

      return rows.reduce(
        (acc, row) => ({
          periodId: quarter.id,
          label: quarter.label,
          status: rows.some((r) => r.status === "current") ? "current" : "locked",
          grossProduction: acc.grossProduction + row.grossProduction,
          serviceFees: acc.serviceFees + row.serviceFees,
          labMaterials: acc.labMaterials + row.labMaterials,
          merchantFees: acc.merchantFees + row.merchantFees,
          feesPaidToFocus: acc.feesPaidToFocus + row.feesPaidToFocus,
          feesPaidInError: acc.feesPaidInError + row.feesPaidInError,
          feesOwed: acc.feesOwed + row.feesOwed,
          finalTotalDue: acc.finalTotalDue + row.finalTotalDue,
        }),
        emptySummaryRow(quarter.label)
      );
    });
  }, [monthlySummary, quarterOptions]);

  const selectedScopeSummary = useMemo(() => {
    if (periodMode === "month") {
      return monthlySummary.find((row) => row.periodId === selectedMonthPeriodId) || null;
    }

    return quarterlySummary.find((row) => row.periodId === selectedQuarterId) || null;
  }, [periodMode, selectedMonthPeriodId, selectedQuarterId, monthlySummary, quarterlySummary]);

  const providerTrendData = useMemo(() => {
    if (periodMode === "month") {
      return ascendingBillingPeriods.map((period) => {
        const row: Record<string, string | number> = {
          label: period.label,
        };

        activeProviders.forEach((provider) => {
          const record = records.find(
            (r) => r.provider_id === provider.id && r.billing_period_id === period.id
          );

          if (!record) {
            row[provider.name] = 0;
            return;
          }

          const autoTotals =
            autoTotalsByProviderAndPeriod[`${provider.id}__${period.id}`] || emptyAutoTotals();

          const feeBase = calculateFeeBase(provider, record, autoTotals);
          row[provider.name] = calculateServiceFee(provider, feeBase);
        });

        return row;
      });
    }

    return quarterOptions.map((quarter) => {
      const row: Record<string, string | number> = {
        label: quarter.label,
      };

      activeProviders.forEach((provider) => {
        let total = 0;

        quarter.periodIds.forEach((periodId) => {
          const record = records.find(
            (r) => r.provider_id === provider.id && r.billing_period_id === periodId
          );

          if (!record) return;

          const autoTotals =
            autoTotalsByProviderAndPeriod[`${provider.id}__${periodId}`] || emptyAutoTotals();

          const feeBase = calculateFeeBase(provider, record, autoTotals);
          total += calculateServiceFee(provider, feeBase);
        });

        row[provider.name] = total;
      });

      return row;
    });
  }, [
    periodMode,
    ascendingBillingPeriods,
    quarterOptions,
    activeProviders,
    records,
    autoTotalsByProviderAndPeriod,
  ]);

  const totalsChartData = useMemo(() => {
    return periodMode === "month" ? monthlySummary : quarterlySummary;
  }, [periodMode, monthlySummary, quarterlySummary]);

  const comparePeriod = useMemo(() => {
    return monthlySummary.find((p) => p.periodId === selectedComparePeriodId) || null;
  }, [monthlySummary, selectedComparePeriodId]);

  const previousComparePeriod = useMemo(() => {
    if (!comparePeriod) return null;
    const index = monthlySummary.findIndex((p) => p.periodId === comparePeriod.periodId);
    if (index <= 0) return null;
    return monthlySummary[index - 1];
  }, [monthlySummary, comparePeriod]);

  const quarterComparePeriod = useMemo(() => {
    return quarterlySummary.find((p) => p.periodId === selectedQuarterId) || null;
  }, [quarterlySummary, selectedQuarterId]);

  const previousQuarterComparePeriod = useMemo(() => {
    if (!quarterComparePeriod) return null;
    const index = quarterlySummary.findIndex((p) => p.periodId === quarterComparePeriod.periodId);
    if (index <= 0) return null;
    return quarterlySummary[index - 1];
  }, [quarterlySummary, quarterComparePeriod]);

  const comparisonDeltas = useMemo(() => {
    if (!comparePeriod || !previousComparePeriod) return null;

    return {
      grossProduction:
        comparePeriod.grossProduction - previousComparePeriod.grossProduction,
      serviceFees: comparePeriod.serviceFees - previousComparePeriod.serviceFees,
      labMaterials: comparePeriod.labMaterials - previousComparePeriod.labMaterials,
      merchantFees: comparePeriod.merchantFees - previousComparePeriod.merchantFees,
      finalTotalDue: comparePeriod.finalTotalDue - previousComparePeriod.finalTotalDue,
    };
  }, [comparePeriod, previousComparePeriod]);

  const quarterComparisonDeltas = useMemo(() => {
    if (!quarterComparePeriod || !previousQuarterComparePeriod) return null;

    return {
      grossProduction:
        quarterComparePeriod.grossProduction - previousQuarterComparePeriod.grossProduction,
      serviceFees: quarterComparePeriod.serviceFees - previousQuarterComparePeriod.serviceFees,
      labMaterials: quarterComparePeriod.labMaterials - previousQuarterComparePeriod.labMaterials,
      merchantFees: quarterComparePeriod.merchantFees - previousQuarterComparePeriod.merchantFees,
      finalTotalDue: quarterComparePeriod.finalTotalDue - previousQuarterComparePeriod.finalTotalDue,
    };
  }, [quarterComparePeriod, previousQuarterComparePeriod]);

  const allowedRankingPeriodIds = useMemo(() => {
    if (periodMode === "month") {
      return selectedMonthPeriodId ? [selectedMonthPeriodId] : [];
    }

    return quarterOptions.find((q) => q.id === selectedQuarterId)?.periodIds || [];
  }, [periodMode, selectedMonthPeriodId, selectedQuarterId, quarterOptions]);

  const providerRanking = useMemo(() => {
    return providers
      .map((provider) => {
        let totalServiceFees = 0;

        records
          .filter(
            (record) =>
              record.provider_id === provider.id &&
              (selectedProviderId === "all" || provider.id === selectedProviderId) &&
              allowedRankingPeriodIds.includes(record.billing_period_id)
          )
          .forEach((record) => {
            const autoTotals =
              autoTotalsByProviderAndPeriod[`${provider.id}__${record.billing_period_id}`] ||
              emptyAutoTotals();

            const feeBase = calculateFeeBase(provider, record, autoTotals);
            totalServiceFees += calculateServiceFee(provider, feeBase);
          });

        return {
          provider: provider.name,
          totalServiceFees,
        };
      })
      .filter((row) => row.totalServiceFees > 0 || selectedProviderId !== "all")
      .sort((a, b) => b.totalServiceFees - a.totalServiceFees);
  }, [
    providers,
    records,
    autoTotalsByProviderAndPeriod,
    selectedProviderId,
    allowedRankingPeriodIds,
  ]);

  const displayedTotals = selectedScopeSummary || emptySummaryRow();
  const latestPeriod = monthlySummary[monthlySummary.length - 1] || null;
  const maxRankingValue = providerRanking[0]?.totalServiceFees || 1;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-7 text-white">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-200">
                  Admin analytics
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Financials Dashboard
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
                  Centralised financial reporting across providers, billing periods,
                  service fees, materials, and total balances due.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {latestPeriod ? (
                  <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
                    <div className="text-xs uppercase tracking-wide text-slate-300">
                      Latest month
                    </div>
                    <div className="mt-1 font-semibold text-white">
                      {latestPeriod.label}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="text-xs uppercase tracking-wide text-slate-300">
                    Current scope
                  </div>
                  <div className="mt-1 font-semibold text-white">
                    {periodMode === "month" ? "Month view" : "ATO quarter view"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => loadData(true)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  Refresh data
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Provider filter
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                >
                  <option value="all">All providers</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Time period type
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={periodMode}
                  onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
                >
                  <option value="month">Month</option>
                  <option value="quarter">Quarter (ATO)</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  {periodMode === "month" ? "Selected month" : "Selected quarter"}
                </label>
                {periodMode === "month" ? (
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    value={selectedMonthPeriodId}
                    onChange={(e) => setSelectedMonthPeriodId(e.target.value)}
                  >
                    {[...ascendingBillingPeriods].reverse().map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    value={selectedQuarterId}
                    onChange={(e) => setSelectedQuarterId(e.target.value)}
                  >
                    {[...quarterOptions].reverse().map((quarter) => (
                      <option key={quarter.id} value={quarter.id}>
                        {quarter.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Comparison month
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={selectedComparePeriodId}
                  onChange={(e) => setSelectedComparePeriodId(e.target.value)}
                >
                  {[...ascendingBillingPeriods].reverse().map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-sm"
              />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Gross production"
                value={`$${formatMoney(displayedTotals.grossProduction)}`}
                subtext={`Total production for ${displayedTotals.label}`}
              />
              <MetricCard
                label="Service fees"
                value={`$${formatMoney(displayedTotals.serviceFees)}`}
                subtext={`Calculated provider service fees for ${displayedTotals.label}`}
              />
              <MetricCard
                label="Lab / materials"
                value={`$${formatMoney(displayedTotals.labMaterials)}`}
                subtext={`Lab and implant materials for ${displayedTotals.label}`}
              />
              <MetricCard
                label="Merchant fees"
                value={`$${formatMoney(displayedTotals.merchantFees)}`}
                subtext={`Humm + Afterpay fees for ${displayedTotals.label}`}
              />
              <MetricCard
                label="Final total due"
                value={`$${formatMoney(displayedTotals.finalTotalDue)}`}
                subtext={`Net amount due for ${displayedTotals.label}`}
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                      Service fees by provider and {periodMode}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Trend view of service fees collected over time in chronological order.
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {activeProviders.length} provider
                    {activeProviders.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="mt-5 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={providerTrendData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-35}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis tickFormatter={(v) => `$${formatCompactMoney(Number(v))}`} />
                      <Tooltip
                        formatter={(value) => `$${formatMoney(Number(value ?? 0))}`}
                        contentStyle={{
                          borderRadius: 16,
                          border: "1px solid #e2e8f0",
                        }}
                      />
                      <Legend />
                      {activeProviders.map((provider) => (
                        <Line
                          key={provider.id}
                          type="monotone"
                          dataKey={provider.name}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  {periodMode === "month" ? "Monthly totals" : "Quarterly totals"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Compare gross production, service fees, and final totals due in chronological order.
                </p>

                <div className="mt-5 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={totalsChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-35}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis tickFormatter={(v) => `$${formatCompactMoney(Number(v))}`} />
                      <Tooltip
                        formatter={(value) => `$${formatMoney(Number(value ?? 0))}`}
                        contentStyle={{
                          borderRadius: 16,
                          border: "1px solid #e2e8f0",
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="grossProduction"
                        name="Gross production"
                        fill="#1e3a8a"
                        radius={[8, 8, 0, 0]}
                      />
                      <Bar
                        dataKey="serviceFees"
                        name="Service fees"
                        fill="#166534"
                        radius={[8, 8, 0, 0]}
                      />
                      <Bar
                        dataKey="finalTotalDue"
                        name="Final total due"
                        fill="#60a5fa"
                        radius={[8, 8, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Month-to-month comparison
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review the selected comparison month against the previous billing period.
                </p>

                {comparePeriod ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-slate-500">Selected month</div>
                          <div className="text-lg font-semibold text-slate-900">
                            {comparePeriod.label}
                          </div>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(
                            comparePeriod.status
                          )}`}
                        >
                          {comparePeriod.status}
                        </span>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Gross production
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.grossProduction)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Service fees
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.serviceFees)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Lab / materials
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.labMaterials)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Merchant fees
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.merchantFees)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Fees paid to Focus
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.feesPaidToFocus)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Final total due
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(comparePeriod.finalTotalDue)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {previousComparePeriod && comparisonDeltas ? (
                      <div className="rounded-3xl border border-slate-200 p-5">
                        <div className="text-sm text-slate-500">Compared with</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {previousComparePeriod.label}
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          {[
                            ["Gross production", comparisonDeltas.grossProduction],
                            ["Service fees", comparisonDeltas.serviceFees],
                            ["Lab / materials", comparisonDeltas.labMaterials],
                            ["Merchant fees", comparisonDeltas.merchantFees],
                            ["Final total due", comparisonDeltas.finalTotalDue],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                            >
                              <span className="text-sm font-medium text-slate-700">
                                {label}
                              </span>
                              <span
                                className={`rounded-full px-3 py-1 text-sm font-semibold ${getDeltaTone(
                                  Number(value)
                                )}`}
                              >
                                {Number(value) > 0 ? "+" : ""}
                                ${formatMoney(Number(value))}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        No previous month available for comparison.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    No comparison month selected.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Quarter-to-quarter comparison
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review the selected ATO quarter against the previous ATO quarter.
                </p>

                {quarterComparePeriod ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-slate-500">Selected quarter</div>
                          <div className="text-lg font-semibold text-slate-900">
                            {quarterComparePeriod.label}
                          </div>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(
                            quarterComparePeriod.status
                          )}`}
                        >
                          {quarterComparePeriod.status}
                        </span>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Gross production
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.grossProduction)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Service fees
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.serviceFees)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Lab / materials
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.labMaterials)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Merchant fees
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.merchantFees)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Fees paid to Focus
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.feesPaidToFocus)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Final total due
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            ${formatMoney(quarterComparePeriod.finalTotalDue)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {previousQuarterComparePeriod && quarterComparisonDeltas ? (
                      <div className="rounded-3xl border border-slate-200 p-5">
                        <div className="text-sm text-slate-500">Compared with</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {previousQuarterComparePeriod.label}
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          {[
                            ["Gross production", quarterComparisonDeltas.grossProduction],
                            ["Service fees", quarterComparisonDeltas.serviceFees],
                            ["Lab / materials", quarterComparisonDeltas.labMaterials],
                            ["Merchant fees", quarterComparisonDeltas.merchantFees],
                            ["Final total due", quarterComparisonDeltas.finalTotalDue],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                            >
                              <span className="text-sm font-medium text-slate-700">
                                {label}
                              </span>
                              <span
                                className={`rounded-full px-3 py-1 text-sm font-semibold ${getDeltaTone(
                                  Number(value)
                                )}`}
                              >
                                {Number(value) > 0 ? "+" : ""}
                                ${formatMoney(Number(value))}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        No previous quarter available for comparison.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    No quarter selected.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Top providers by service fees
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ranked by total service fees for the selected month or quarter.
                </p>

                <div className="mt-5 space-y-3">
                  {providerRanking.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                      No provider ranking data available.
                    </div>
                  ) : (
                    providerRanking.map((row, index) => {
                      const width = `${(row.totalServiceFees / maxRankingValue) * 100}%`;

                      return (
                        <div
                          key={row.provider}
                          className="rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                                {index + 1}
                              </div>
                              <div>
                                <div className="font-medium text-slate-900">
                                  {row.provider}
                                </div>
                                <div className="text-xs text-slate-500">
                                  Total service fees
                                </div>
                              </div>
                            </div>

                            <div className="text-right text-base font-semibold text-slate-900">
                              ${formatMoney(row.totalServiceFees)}
                            </div>
                          </div>

                          <div className="mt-4 h-2.5 rounded-full bg-slate-100">
                            <div
                              className="h-2.5 rounded-full bg-slate-900"
                              style={{ width }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Billing period health
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Status and financial snapshot by billing period.
                </p>

                <div className="mt-5 max-h-[560px] space-y-4 overflow-y-auto pr-1">
                  {[...ascendingBillingPeriods].reverse().map((period) => {
                    const periodSummary = monthlySummary.find((m) => m.periodId === period.id);

                    return (
                      <div
                        key={period.id}
                        className="rounded-3xl border border-slate-200 p-5 transition hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{period.label}</div>
                            <div className="mt-1 text-sm text-slate-500">Billing period</div>
                          </div>

                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(
                              period.status
                            )}`}
                          >
                            {period.status}
                          </span>
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Service fees
                            </div>
                            <div className="mt-1 font-semibold text-slate-900">
                              ${formatMoney(periodSummary?.serviceFees || 0)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Final total due
                            </div>
                            <div className="mt-1 font-semibold text-slate-900">
                              ${formatMoney(periodSummary?.finalTotalDue || 0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}