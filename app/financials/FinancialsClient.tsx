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

function formatMoney(value: number) {
  return value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

export default function FinancialsClient() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [records, setRecords] = useState<ProviderMonthlyRecord[]>([]);
  const [patientEntries, setPatientEntries] = useState<PatientFinancialEntry[]>([]);
  const [detailEntries, setDetailEntries] = useState<BillingDetailEntry[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("all");
  const [selectedComparePeriodId, setSelectedComparePeriodId] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");

  async function loadData() {
    const [
      providerRes,
      periodRes,
      recordRes,
      patientRes,
      detailRes,
    ] = await Promise.all([
      supabase.from("providers").select("*").order("name"),
      supabase
        .from("billing_periods")
        .select("*")
        .order("year", { ascending: true })
        .order("month", { ascending: true }),
      supabase.from("provider_monthly_records").select("*"),
      supabase
        .from("patient_financial_entries")
        .select("*")
        .is("deleted_at", null),
      supabase
        .from("billing_detail_entries")
        .select("*")
        .is("deleted_at", null),
    ]);

    if (providerRes.error) {
      setTone("error");
      setMessage(`Error loading providers: ${providerRes.error.message}`);
      return;
    }
    if (periodRes.error) {
      setTone("error");
      setMessage(`Error loading periods: ${periodRes.error.message}`);
      return;
    }
    if (recordRes.error) {
      setTone("error");
      setMessage(`Error loading records: ${recordRes.error.message}`);
      return;
    }
    if (patientRes.error) {
      setTone("error");
      setMessage(`Error loading patient entries: ${patientRes.error.message}`);
      return;
    }
    if (detailRes.error) {
      setTone("error");
      setMessage(`Error loading detail entries: ${detailRes.error.message}`);
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
      setSelectedComparePeriodId(loadedPeriods[loadedPeriods.length - 1].id);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoTotalsByProviderAndPeriod = useMemo(() => {
    const totals: Record<string, AutoTotals> = {};

    function key(providerId: string, periodId: string) {
      return `${providerId}__${periodId}`;
    }

    for (const entry of patientEntries) {
      if (!entry.billing_period_id) continue;
      const k = key(entry.provider_id, entry.billing_period_id);

      if (!totals[k]) {
        totals[k] = {
          labImplantMaterials: 0,
          feesPaidToFocus: 0,
          feesPaidInError: 0,
          feesOwed: 0,
          hummFees: 0,
          afterpayFees: 0,
        };
      }

      const amount = Number(entry.amount || 0);

      if (entry.category === "lab_implant_materials") {
        totals[k].labImplantMaterials += amount;
      }
      if (entry.category === "fees_paid_to_focus") {
        totals[k].feesPaidToFocus += amount;
      }
      if (entry.category === "fees_paid_in_error") {
        totals[k].feesPaidInError += amount;
      }
      if (entry.category === "fees_owed") {
        totals[k].feesOwed += amount;
      }
      if (entry.category === "paid_to_wrong_provider") {
        totals[k].feesPaidInError += amount;

        if (entry.related_provider_id) {
          const owedKey = key(entry.related_provider_id, entry.billing_period_id);
          if (!totals[owedKey]) {
            totals[owedKey] = {
              labImplantMaterials: 0,
              feesPaidToFocus: 0,
              feesPaidInError: 0,
              feesOwed: 0,
              hummFees: 0,
              afterpayFees: 0,
            };
          }
          totals[owedKey].feesOwed += amount;
        }
      }
    }

    for (const entry of detailEntries) {
      const k = key(entry.provider_id, entry.billing_period_id);

      if (!totals[k]) {
        totals[k] = {
          labImplantMaterials: 0,
          feesPaidToFocus: 0,
          feesPaidInError: 0,
          feesOwed: 0,
          hummFees: 0,
          afterpayFees: 0,
        };
      }

      const amount = Number(entry.amount || 0);

      if (entry.category === "humm_fee") {
        totals[k].hummFees += amount;
      }

      if (entry.category === "afterpay_fee") {
        totals[k].afterpayFees += amount;
      }
    }

    return totals;
  }, [patientEntries, detailEntries]);

  const monthlySummary = useMemo(() => {
    return billingPeriods.map((period) => {
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
          autoTotalsByProviderAndPeriod[`${record.provider_id}__${record.billing_period_id}`] || {
            labImplantMaterials: 0,
            feesPaidToFocus: 0,
            feesPaidInError: 0,
            feesOwed: 0,
            hummFees: 0,
            afterpayFees: 0,
          };

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
  }, [billingPeriods, records, providers, autoTotalsByProviderAndPeriod, selectedProviderId]);

  const providerTrendData = useMemo(() => {
    const activeProviders =
      selectedProviderId === "all"
        ? providers
        : providers.filter((p) => p.id === selectedProviderId);

    return billingPeriods.map((period) => {
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
          autoTotalsByProviderAndPeriod[`${provider.id}__${period.id}`] || {
            labImplantMaterials: 0,
            feesPaidToFocus: 0,
            feesPaidInError: 0,
            feesOwed: 0,
            hummFees: 0,
            afterpayFees: 0,
          };

        const feeBase = calculateFeeBase(provider, record, autoTotals);
        row[provider.name] = calculateServiceFee(provider, feeBase);
      });

      return row;
    });
  }, [billingPeriods, providers, records, autoTotalsByProviderAndPeriod, selectedProviderId]);

  const comparePeriod = useMemo(() => {
    return monthlySummary.find((p) => p.periodId === selectedComparePeriodId) || null;
  }, [monthlySummary, selectedComparePeriodId]);

  const previousComparePeriod = useMemo(() => {
    if (!comparePeriod) return null;
    const index = monthlySummary.findIndex((p) => p.periodId === comparePeriod.periodId);
    if (index <= 0) return null;
    return monthlySummary[index - 1];
  }, [monthlySummary, comparePeriod]);

  const providerRanking = useMemo(() => {
    return providers
      .map((provider) => {
        let totalServiceFees = 0;

        records
          .filter(
            (record) =>
              record.provider_id === provider.id &&
              (selectedProviderId === "all" || provider.id === selectedProviderId)
          )
          .forEach((record) => {
            const autoTotals =
              autoTotalsByProviderAndPeriod[`${provider.id}__${record.billing_period_id}`] || {
                labImplantMaterials: 0,
                feesPaidToFocus: 0,
                feesPaidInError: 0,
                feesOwed: 0,
                hummFees: 0,
                afterpayFees: 0,
              };

            const feeBase = calculateFeeBase(provider, record, autoTotals);
            totalServiceFees += calculateServiceFee(provider, feeBase);
          });

        return {
          provider: provider.name,
          totalServiceFees,
        };
      })
      .sort((a, b) => b.totalServiceFees - a.totalServiceFees);
  }, [providers, records, autoTotalsByProviderAndPeriod, selectedProviderId]);

  const totals = useMemo(() => {
    return monthlySummary.reduce(
      (acc, row) => {
        acc.grossProduction += row.grossProduction;
        acc.serviceFees += row.serviceFees;
        acc.labMaterials += row.labMaterials;
        acc.merchantFees += row.merchantFees;
        acc.finalTotalDue += row.finalTotalDue;
        return acc;
      },
      {
        grossProduction: 0,
        serviceFees: 0,
        labMaterials: 0,
        merchantFees: 0,
        finalTotalDue: 0,
      }
    );
  }, [monthlySummary]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Financials Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Admin-only analytics across providers and billing periods.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Provider filter</label>
              <select
                className="w-full rounded-2xl border bg-white px-3 py-2"
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
              <label className="mb-1 block text-sm">Comparison month</label>
              <select
                className="w-full rounded-2xl border bg-white px-3 py-2"
                value={selectedComparePeriodId}
                onChange={(e) => setSelectedComparePeriodId(e.target.value)}
              >
                {billingPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Gross production</div>
            <div className="mt-2 text-2xl font-semibold">${formatMoney(totals.grossProduction)}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Service fees</div>
            <div className="mt-2 text-2xl font-semibold">${formatMoney(totals.serviceFees)}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Lab / materials</div>
            <div className="mt-2 text-2xl font-semibold">${formatMoney(totals.labMaterials)}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Merchant fees</div>
            <div className="mt-2 text-2xl font-semibold">${formatMoney(totals.merchantFees)}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Final total due</div>
            <div className="mt-2 text-2xl font-semibold">${formatMoney(totals.finalTotalDue)}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Service fees by provider and month</h2>
            <p className="mt-1 text-sm text-slate-500">
              Trend line of service fees collected over time.
            </p>

            <div className="mt-4 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={providerTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => `$${formatMoney(Number(value || 0))}`} />
                  <Legend />
                  {(selectedProviderId === "all" ? providers : providers.filter((p) => p.id === selectedProviderId)).map(
                    (provider) => (
                      <Line
                        key={provider.id}
                        type="monotone"
                        dataKey={provider.name}
                        strokeWidth={2}
                        dot={false}
                      />
                    )
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Monthly totals</h2>
            <p className="mt-1 text-sm text-slate-500">
              Compare gross production, service fees, and final totals due by month.
            </p>

            <div className="mt-4 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySummary}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => `$${formatMoney(Number(value || 0))}`} />
                  <Legend />
                  <Bar dataKey="grossProduction" name="Gross production" />
                  <Bar dataKey="serviceFees" name="Service fees" />
                  <Bar dataKey="finalTotalDue" name="Final total due" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Month-to-month comparison</h2>

            {comparePeriod ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="font-medium">{comparePeriod.label}</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>Gross production: ${formatMoney(comparePeriod.grossProduction)}</div>
                    <div>Service fees: ${formatMoney(comparePeriod.serviceFees)}</div>
                    <div>Lab / materials: ${formatMoney(comparePeriod.labMaterials)}</div>
                    <div>Merchant fees: ${formatMoney(comparePeriod.merchantFees)}</div>
                    <div>Fees paid to Focus: ${formatMoney(comparePeriod.feesPaidToFocus)}</div>
                    <div>Final total due: ${formatMoney(comparePeriod.finalTotalDue)}</div>
                  </div>
                </div>

                {previousComparePeriod && (
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">
                      Compared with {previousComparePeriod.label}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        Gross production change: $
                        {formatMoney(comparePeriod.grossProduction - previousComparePeriod.grossProduction)}
                      </div>
                      <div>
                        Service fee change: $
                        {formatMoney(comparePeriod.serviceFees - previousComparePeriod.serviceFees)}
                      </div>
                      <div>
                        Lab / materials change: $
                        {formatMoney(comparePeriod.labMaterials - previousComparePeriod.labMaterials)}
                      </div>
                      <div>
                        Merchant fee change: $
                        {formatMoney(comparePeriod.merchantFees - previousComparePeriod.merchantFees)}
                      </div>
                      <div>
                        Final total due change: $
                        {formatMoney(comparePeriod.finalTotalDue - previousComparePeriod.finalTotalDue)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">No comparison month selected.</div>
            )}
          </div>

          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Top providers by service fees</h2>

            <div className="mt-4 space-y-3">
              {providerRanking.map((row) => (
                <div
                  key={row.provider}
                  className="flex items-center justify-between rounded-2xl border p-4"
                >
                  <div className="font-medium">{row.provider}</div>
                  <div className="text-right font-semibold">
                    ${formatMoney(row.totalServiceFees)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Billing period health</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {billingPeriods.map((period) => (
              <div key={period.id} className="rounded-2xl border p-4">
                <div className="font-medium">{period.label}</div>
                <div className="mt-1 text-sm text-slate-500">
                  Status:{" "}
                  <span
                    className={
                      period.status === "locked"
                        ? "font-semibold text-amber-700"
                        : "font-semibold text-emerald-700"
                    }
                  >
                    {period.status}
                  </span>
                </div>

                <div className="mt-3 text-sm text-slate-600">
                  Service fees: $
                  {formatMoney(
                    monthlySummary.find((m) => m.periodId === period.id)?.serviceFees || 0
                  )}
                </div>
                <div className="text-sm text-slate-600">
                  Final total due: $
                  {formatMoney(
                    monthlySummary.find((m) => m.periodId === period.id)?.finalTotalDue || 0
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}