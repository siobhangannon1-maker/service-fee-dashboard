"use client";

import Link from "next/link";
import {
  ensureCurrentBillingPeriod,
  createNextBillingPeriodFromList,
} from "@/lib/billingPeriods";
import StatusBadge from "@/components/ui/StatusBadge";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateServiceFee } from "@/lib/calculations";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { writeAuditLog, writeStatementHistory } from "@/lib/audit";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Toast from "@/components/ui/Toast";
import ExcelJS from "exceljs";

type Provider = {
  id: string;
  name: string;
  specialty: string;
  email?: string | null;
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
  locked_at?: string | null;
  locked_by?: string | null;
};

type BillingPeriodImportLink = {
  billing_period_id: string;
  import_id: string;
};

type EntryCategory =
  | "lab_implant_materials"
  | "fees_paid_to_focus"
  | "fees_paid_in_error"
  | "fees_owed"
  | "paid_to_wrong_provider";

type PatientFinancialEntry = {
  id: string;
  provider_id: string;
  related_provider_id: string | null;
  billing_period_id: string | null;
  patient_name: string;
  entry_date: string;
  category: EntryCategory;
  amount: number;
  notes: string | null;
  deleted_at?: string | null;
};

type BillingDetailEntryCategory =
  | "humm_fee"
  | "afterpay_fee"
  | "incorrect_payment";

type BillingDetailEntry = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  patient_name: string | null;
  entry_date: string;
  category: BillingDetailEntryCategory;
  amount: number;
  notes: string | null;
  deleted_at?: string | null;
};

type ProviderMonthlyRecord = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  gross_production: number | null;
  adjustments: number | null;
  incorrect_payments: number | null;
  iv_facility_fees: number | null;
  afterpay_fees: number | null;
  humm_fees: number | null;
  other_deductions?: number | null;
};

type ProviderImportMetrics = {
  grossProduction: number;
  collections: number;
  serviceFeeBase: number;
  ivFacilityFees: number;
};

type ManualBillingInputs = {
  grossProduction: number;
  adjustments: number;
  incorrectPayments: number;
  ivFacilityFees: number;
  otherDeductions: number;
};

type AutoTotals = {
  labImplantMaterials: number;
  feesPaidToFocus: number;
  feesPaidInError: number;
  feesOwed: number;
  hummFees: number;
  afterpayFees: number;
};

const emptyManualInputs: ManualBillingInputs = {
  grossProduction: 0,
  adjustments: 0,
  incorrectPayments: 0,
  ivFacilityFees: 0,
  otherDeductions: 0,
};

const PRACTICE = {
  name: "Focus Dental Specialists Pty Ltd",
  address: "7/377 Cavendish Road COORPAROO QLD 4151",
  phone: "07 3077 9620",
  email: "hello@focusoms.com.au",
  abn: "44 642 634 982",
};

export default function BillingClient() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [activePeriodStatus, setActivePeriodStatus] = useState<"open" | "locked">(
    "open"
  );
  const [entries, setEntries] = useState<PatientFinancialEntry[]>([]);
  const [billingDetailEntries, setBillingDetailEntries] = useState<
    BillingDetailEntry[]
  >([]);
  const [manualBillingData, setManualBillingData] = useState<
    Record<string, ManualBillingInputs>
  >({});
  const [savedRecords, setSavedRecords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [toastTone, setToastTone] = useState<"default" | "success" | "error">(
    "default"
  );
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Please confirm");
  const [confirmDescription, setConfirmDescription] = useState(
    "Are you sure you want to continue?"
  );
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  function showToast(
    nextMessage: string,
    tone: "default" | "success" | "error" = "default"
  ) {
    setMessage(nextMessage);
    setToastTone(tone);
  }

  function openConfirm(options: {
    title: string;
    description: string;
    danger?: boolean;
    action: () => void;
  }) {
    setConfirmTitle(options.title);
    setConfirmDescription(options.description);
    setConfirmDanger(!!options.danger);
    setConfirmAction(() => options.action);
    setConfirmOpen(true);
  }

  async function fetchProviderImportMetrics(
    providerId: string,
    importId: string
  ): Promise<ProviderImportMetrics> {
    const res = await fetch(`/api/providers/${providerId}/metrics/${importId}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to load metrics for provider ${providerId}`);
    }

    const data = await res.json();

    return {
      grossProduction: Number(data.grossProduction || 0),
      collections: Number(data.collections || 0),
      serviceFeeBase: Number(data.serviceFeeBase || 0),
      ivFacilityFees: Number(data.ivFacilityFees || 0),
    };
  }

  async function getImportIdForBillingPeriod(
    billingPeriodId: string
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from("billing_period_imports")
      .select("billing_period_id, import_id")
      .eq("billing_period_id", billingPeriodId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const link = data as BillingPeriodImportLink | null;
    return link?.import_id ?? null;
  }

  async function loadData(periodId?: string) {
    setMessage("");
    setLoadingMetrics(true);

    try {
      const ensuredCurrentPeriod = await ensureCurrentBillingPeriod();

      const { data: providerData, error: providerError } = await supabase
        .from("providers")
        .select("*")
        .order("name");

      if (providerError) {
        showToast(`Error loading providers: ${providerError.message}`, "error");
        setLoadingMetrics(false);
        return;
      }

      const { data: periodData, error: periodError } = await supabase
        .from("billing_periods")
        .select("*")
        .order("year", { ascending: true })
        .order("month", { ascending: true });

      if (periodError) {
        showToast(`Error loading billing periods: ${periodError.message}`, "error");
        setLoadingMetrics(false);
        return;
      }

      const providerList = (providerData || []) as Provider[];
      const periodList = (periodData || []) as BillingPeriod[];

      setProviders(providerList);
      setBillingPeriods(periodList);

      const activePeriodId =
        periodId ||
        selectedPeriodId ||
        ensuredCurrentPeriod.id ||
        periodList[periodList.length - 1]?.id ||
        "";

      if (activePeriodId && activePeriodId !== selectedPeriodId) {
        setSelectedPeriodId(activePeriodId);
      }

      const activePeriod = periodList.find((p) => p.id === activePeriodId);
      setActivePeriodStatus((activePeriod?.status as "open" | "locked") || "open");

      let activeImportId: string | null = null;

      if (activePeriodId) {
        try {
          activeImportId = await getImportIdForBillingPeriod(activePeriodId);
        } catch (error: any) {
          showToast(
            `Error loading billing/import link: ${error?.message || "Unknown error"}`,
            "error"
          );
          setLoadingMetrics(false);
          return;
        }
      }

      let entryQuery = supabase
        .from("patient_financial_entries")
        .select("*")
        .is("deleted_at", null);

      if (activePeriodId) {
        entryQuery = entryQuery.eq("billing_period_id", activePeriodId);
      }

      const { data: entryData, error: entryError } = await entryQuery;

      if (entryError) {
        showToast(`Error loading patient entries: ${entryError.message}`, "error");
        setLoadingMetrics(false);
        return;
      }

      setEntries((entryData || []) as PatientFinancialEntry[]);

      let detailQuery = supabase
        .from("billing_detail_entries")
        .select("*")
        .is("deleted_at", null);

      if (activePeriodId) {
        detailQuery = detailQuery.eq("billing_period_id", activePeriodId);
      }

      const { data: detailData, error: detailError } = await detailQuery;

      if (detailError) {
        showToast(
          `Error loading billing detail entries: ${detailError.message}`,
          "error"
        );
        setLoadingMetrics(false);
        return;
      }

      setBillingDetailEntries((detailData || []) as BillingDetailEntry[]);

      let recordQuery = supabase.from("provider_monthly_records").select("*");
      if (activePeriodId) {
        recordQuery = recordQuery.eq("billing_period_id", activePeriodId);
      }

      const { data: recordData, error: recordError } = await recordQuery;

      if (recordError) {
        showToast(`Error loading monthly records: ${recordError.message}`, "error");
        setLoadingMetrics(false);
        return;
      }

      const records = (recordData || []) as ProviderMonthlyRecord[];

      const importMetricsByProvider: Record<string, ProviderImportMetrics> = {};
      const failedProviders: string[] = [];

      if (activeImportId) {
        await Promise.all(
          providerList.map(async (provider) => {
            try {
              const metrics = await fetchProviderImportMetrics(
                provider.id,
                activeImportId as string
              );

              importMetricsByProvider[provider.id] = metrics;
            } catch (error) {
              console.error(`Failed to fetch metrics for ${provider.name}`, error);
              failedProviders.push(provider.name);
              importMetricsByProvider[provider.id] = {
                grossProduction: 0,
                collections: 0,
                serviceFeeBase: 0,
                ivFacilityFees: 0,
              };
            }
          })
        );
      }

      const nextManualData: Record<string, ManualBillingInputs> = {};
      const nextSavedRecords: Record<string, string> = {};

      providerList.forEach((provider) => {
        const record = records.find((r) => r.provider_id === provider.id);
        const importedMetrics = importMetricsByProvider[provider.id];

        nextManualData[provider.id] = record
          ? {
              grossProduction: Number(
                record.gross_production ?? importedMetrics?.grossProduction ?? 0
              ),
              adjustments: Number(record.adjustments || 0),
              incorrectPayments: Number(record.incorrect_payments || 0),
              ivFacilityFees: Number(
                record.iv_facility_fees ?? importedMetrics?.ivFacilityFees ?? 0
              ),
              otherDeductions: Number(record.other_deductions || 0),
            }
          : {
              grossProduction: Number(importedMetrics?.grossProduction || 0),
              adjustments: 0,
              incorrectPayments: 0,
              ivFacilityFees: Number(importedMetrics?.ivFacilityFees || 0),
              otherDeductions: 0,
            };

        if (record?.id) {
          nextSavedRecords[provider.id] = record.id;
        }
      });

      setManualBillingData(nextManualData);
      setSavedRecords(nextSavedRecords);

      const storedLogo = await fetchStoredLogoDataUrl();
      if (storedLogo) {
        setLogoDataUrl(storedLogo);
      }

      if (failedProviders.length > 0) {
        showToast(
          `Some provider import values could not be loaded: ${failedProviders.join(", ")}`,
          "error"
        );
      }
    } catch (error: any) {
      showToast(
        `Error preparing billing period: ${error?.message || "Unknown error"}`,
        "error"
      );
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateManualBilling(
    providerId: string,
    field: keyof ManualBillingInputs,
    value: number
  ) {
    setManualBillingData((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        [field]: value,
      },
    }));
  }

  async function createNextBillingPeriod() {
    try {
      setMessage("");

      const createdPeriod = await createNextBillingPeriodFromList(billingPeriods);

      showToast(`Billing period created: ${createdPeriod.label}`, "success");
      await loadData(createdPeriod.id);
    } catch (error: any) {
      showToast(
        `Failed to create billing period: ${error?.message || "Unknown error"}`,
        "error"
      );
    }
  }

  async function toggleBillingPeriodLock() {
    if (!selectedPeriodId) {
      showToast("Please select a billing period first.", "error");
      return;
    }

    const nextStatus = activePeriodStatus === "locked" ? "open" : "locked";

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload =
      nextStatus === "locked"
        ? {
            status: nextStatus,
            locked_at: new Date().toISOString(),
            locked_by: user?.id ?? null,
          }
        : {
            status: nextStatus,
            locked_at: null,
            locked_by: null,
          };

    const { error } = await supabase
      .from("billing_periods")
      .update(payload)
      .eq("id", selectedPeriodId);

    if (error) {
      showToast(`Failed to update billing period: ${error.message}`, "error");
      return;
    }

    await writeAuditLog({
      action:
        nextStatus === "locked" ? "billing_period_locked" : "billing_period_unlocked",
      entityType: "billing_period",
      entityId: selectedPeriodId,
      billingPeriodId: selectedPeriodId,
      metadata: { nextStatus },
    });

    showToast(
      nextStatus === "locked" ? "Billing period locked." : "Billing period reopened.",
      "success"
    );

    await loadData(selectedPeriodId);
  }

  async function saveProviderRecord(
    providerId: string,
    options?: { suppressToast?: boolean }
  ) {
    if (!selectedPeriodId) {
      if (!options?.suppressToast) {
        showToast("Please select a billing period first.", "error");
      }
      return { success: false };
    }

    if (activePeriodStatus === "locked") {
      if (!options?.suppressToast) {
        showToast("This billing period is locked.", "error");
      }
      return { success: false };
    }

    if (loadingMetrics) {
      if (!options?.suppressToast) {
        showToast("Imported values are still loading. Please wait.", "error");
      }
      return { success: false };
    }

    const inputs = manualBillingData[providerId] || emptyManualInputs;
    if (!savingAll) {
      setSavingProviderId(providerId);
    }
    setMessage("");

    const payload = {
      provider_id: providerId,
      billing_period_id: selectedPeriodId,
      gross_production: inputs.grossProduction,
      adjustments: inputs.adjustments,
      incorrect_payments: inputs.incorrectPayments,
      iv_facility_fees: inputs.ivFacilityFees,
      other_deductions: inputs.otherDeductions,
    };

    const existingId = savedRecords[providerId];

    const result = existingId
      ? await supabase
          .from("provider_monthly_records")
          .update(payload)
          .eq("id", existingId)
      : await supabase
          .from("provider_monthly_records")
          .insert(payload)
          .select("id")
          .single();

    if (result.error) {
      if (!options?.suppressToast) {
        showToast(`Save failed: ${result.error.message}`, "error");
      }
      if (!savingAll) {
        setSavingProviderId(null);
      }
      return { success: false, error: result.error.message };
    }

    let savedId = existingId;

    if (!existingId && "data" in result && result.data?.id) {
      savedId = result.data.id;
      setSavedRecords((prev) => ({ ...prev, [providerId]: result.data.id }));
    }

    await writeAuditLog({
      action: existingId
        ? "provider_monthly_record_updated"
        : "provider_monthly_record_created",
      entityType: "provider_monthly_record",
      entityId: savedId || null,
      billingPeriodId: selectedPeriodId,
      providerId,
      metadata: payload,
    });

    if (!options?.suppressToast) {
      showToast("Billing values saved.", "success");
    }

    if (!savingAll) {
      setSavingProviderId(null);
    }

    return { success: true };
  }

  async function saveAllProviderRecords() {
    if (!selectedPeriodId) {
      showToast("Please select a billing period first.", "error");
      return;
    }

    if (activePeriodStatus === "locked") {
      showToast("This billing period is locked.", "error");
      return;
    }

    if (loadingMetrics) {
      showToast("Imported values are still loading. Please wait.", "error");
      return;
    }

    setSavingAll(true);
    setMessage("");

    let successCount = 0;
    const failedProviders: string[] = [];

    try {
      for (const provider of providers) {
        const result = await saveProviderRecord(provider.id, { suppressToast: true });

        if (result.success) {
          successCount += 1;
        } else {
          failedProviders.push(provider.name);
        }
      }

      if (failedProviders.length === 0) {
        showToast(`Saved ${successCount} provider records.`, "success");
      } else {
        showToast(
          `Saved ${successCount} provider records. Failed: ${failedProviders.join(", ")}`,
          "error"
        );
      }
    } finally {
      setSavingAll(false);
      setSavingProviderId(null);
    }
  }

  const autoTotalsByProvider = useMemo(() => {
    const totals: Record<string, AutoTotals> = {};

    for (const provider of providers) {
      totals[provider.id] = {
        labImplantMaterials: 0,
        feesPaidToFocus: 0,
        feesPaidInError: 0,
        feesOwed: 0,
        hummFees: 0,
        afterpayFees: 0,
      };
    }

    for (const entry of entries) {
      if (!totals[entry.provider_id]) {
        totals[entry.provider_id] = {
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
        totals[entry.provider_id].labImplantMaterials += amount;
      }

      if (entry.category === "fees_paid_to_focus") {
        totals[entry.provider_id].feesPaidToFocus += amount;
      }

      if (entry.category === "fees_paid_in_error") {
        totals[entry.provider_id].feesPaidInError += amount;
      }

      if (entry.category === "fees_owed") {
        totals[entry.provider_id].feesOwed += amount;
      }

      if (entry.category === "paid_to_wrong_provider") {
        totals[entry.provider_id].feesPaidInError += amount;

        if (entry.related_provider_id) {
          if (!totals[entry.related_provider_id]) {
            totals[entry.related_provider_id] = {
              labImplantMaterials: 0,
              feesPaidToFocus: 0,
              feesPaidInError: 0,
              feesOwed: 0,
              hummFees: 0,
              afterpayFees: 0,
            };
          }

          totals[entry.related_provider_id].feesOwed += amount;
        }
      }
    }

    for (const detail of billingDetailEntries) {
      if (!totals[detail.provider_id]) {
        totals[detail.provider_id] = {
          labImplantMaterials: 0,
          feesPaidToFocus: 0,
          feesPaidInError: 0,
          feesOwed: 0,
          hummFees: 0,
          afterpayFees: 0,
        };
      }

      const amount = Number(detail.amount || 0);

      if (detail.category === "humm_fee") {
        totals[detail.provider_id].hummFees += amount;
      }

      if (detail.category === "afterpay_fee") {
        totals[detail.provider_id].afterpayFees += amount;
      }
    }

    return totals;
  }, [entries, billingDetailEntries, providers]);

  function calculateFeeBase(
    provider: Provider,
    manualInputs: ManualBillingInputs,
    autoTotals: AutoTotals
  ) {
    return (
      manualInputs.grossProduction -
      (provider.deduct_adjustments ? manualInputs.adjustments : 0) -
      autoTotals.hummFees -
      autoTotals.afterpayFees -
      (provider.deduct_iv_fees ? manualInputs.ivFacilityFees : 0) -
      autoTotals.labImplantMaterials -
      manualInputs.otherDeductions
    );
  }

  function currency(value: number) {
    return value.toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getProviderCalculations(provider: Provider) {
    const manualInputs = manualBillingData[provider.id] || emptyManualInputs;
    const autoTotals = autoTotalsByProvider[provider.id] || {
      labImplantMaterials: 0,
      feesPaidToFocus: 0,
      feesPaidInError: 0,
      feesOwed: 0,
      hummFees: 0,
      afterpayFees: 0,
    };

    const feeBase = calculateFeeBase(provider, manualInputs, autoTotals);
    const serviceFee = calculateServiceFee(provider, feeBase);
    const gst = serviceFee * 0.1;
    const totalFeesDue = serviceFee + gst;
    const feesAndCostsTotal =
      totalFeesDue + autoTotals.hummFees + autoTotals.labImplantMaterials;
    const finalTotalDue =
      feesAndCostsTotal -
      autoTotals.feesPaidToFocus +
      autoTotals.feesOwed -
      autoTotals.feesPaidInError +
      manualInputs.ivFacilityFees;

    return {
      manualInputs,
      autoTotals,
      feeBase,
      serviceFee,
      gst,
      totalFeesDue,
      feesAndCostsTotal,
      finalTotalDue,
    };
  }

  function sanitizeFileName(name: string) {
    return name.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
  }

  async function addLogoToWorksheet(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet
  ) {
    if (!logoDataUrl) return;

    const base64 = logoDataUrl.split(",")[1];
    if (!base64) return;

    const extension = logoDataUrl.includes("image/png") ? "png" : "jpeg";

    const imageId = workbook.addImage({
      base64,
      extension,
    });

    worksheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 180, height: 70 },
    });
  }

  function applyValueStyle(cell: ExcelJS.Cell, bold = false) {
    cell.font = { bold, size: bold ? 11 : 10 };
    cell.numFmt = "#,##0.00";
  }

  function addLabeledValueRow(
    worksheet: ExcelJS.Worksheet,
    rowNumber: number,
    label: string,
    value: number,
    options?: { bold?: boolean; indent?: number }
  ) {
    const row = worksheet.getRow(rowNumber);
    row.getCell(1).value = label;
    row.getCell(4).value = value;
    row.getCell(4).numFmt = "#,##0.00";
    row.getCell(4).alignment = { horizontal: "right" };
    applyValueStyle(row.getCell(4), options?.bold);
    row.getCell(1).alignment = { indent: options?.indent || 0 };
    row.getCell(1).font = { bold: !!options?.bold, size: 10 };
    row.height = 18;
  }

  function buildStatementPreviewHtml(provider: Provider) {
    const {
      autoTotals,
      totalFeesDue,
      feesAndCostsTotal,
      finalTotalDue,
      manualInputs,
    } = getProviderCalculations(provider);

    const providerPatientEntries = entries.filter(
      (entry) => entry.provider_id === provider.id
    );

    const providerDetailEntries = billingDetailEntries.filter(
      (entry) => entry.provider_id === provider.id
    );

    const implantEntries = providerPatientEntries.filter(
      (entry) => entry.category === "lab_implant_materials"
    );

    const paidToFocusEntries = providerPatientEntries.filter(
      (entry) => entry.category === "fees_paid_to_focus"
    );

    const paidInErrorEntries = providerPatientEntries.filter(
      (entry) =>
        entry.category === "fees_paid_in_error" ||
        entry.category === "paid_to_wrong_provider"
    );

    const hummEntries = providerDetailEntries.filter(
      (entry) => entry.category === "humm_fee"
    );

    const afterpayEntries = providerDetailEntries.filter(
      (entry) => entry.category === "afterpay_fee"
    );

    function money(value: number) {
      return value.toLocaleString("en-AU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    function renderRows(
      items: Array<{
        patient_name?: string | null;
        notes?: string | null;
        amount: number;
      }>
    ) {
      if (!items.length) {
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;" colspan="3">Nil</td>
        </tr>`;
      }

      return items
        .map(
          (item) => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;">
                ${item.patient_name || ""}
              </td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;">
                ${item.notes || ""}
              </td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">
                ${money(Number(item.amount || 0))}
              </td>
            </tr>
          `
        )
        .join("");
    }

    function sectionTable(
      title: string,
      items: Array<{
        patient_name?: string | null;
        notes?: string | null;
        amount: number;
      }>,
      total: number
    ) {
      return `
        <div style="margin-top:24px;">
          <h3 style="margin:0 0 10px 0;font-size:16px;color:#0f172a;">${title}</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="text-align:left;padding:8px;border-bottom:1px solid #cbd5e1;">Patient</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #cbd5e1;">Notes</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid #cbd5e1;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${renderRows(items)}
              <tr>
                <td colspan="2" style="padding:8px;border-top:2px solid #0f172a;font-weight:600;">Total</td>
                <td style="padding:8px;border-top:2px solid #0f172a;text-align:right;font-weight:600;">
                  ${money(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div style="font-family:Arial,sans-serif;max-width:860px;margin:0 auto;color:#0f172a;">
        <div style="margin-bottom:24px;">
          <h1 style="margin:0;font-size:28px;">Draft Statement</h1>
          <h2 style="margin:8px 0 0 0;font-size:22px;">${provider.name}</h2>
          <p style="margin:8px 0 0 0;color:#475569;">${PRACTICE.name}</p>
          <p style="margin:4px 0 0 0;color:#475569;">${PRACTICE.address}</p>

          <div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:14px;line-height:1.5;">
            Attached is a draft statement for ${
              billingPeriods.find((p) => p.id === selectedPeriodId)?.label || "this billing period"
            }.
            If you have any questions or changes, please email
            <a href="mailto:accounts@focusoms.com.au" style="color:#1d4ed8;text-decoration:underline;">
              accounts@focusoms.com.au
            </a>.
          </div>
        </div>

        <div style="border:1px solid #e2e8f0;border-radius:16px;padding:18px;background:#f8fafc;">
          <h3 style="margin:0 0 12px 0;font-size:16px;">Summary</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tbody>
              <tr>
                <td style="padding:6px 0;">Total fees due</td>
                <td style="padding:6px 0;text-align:right;">${money(totalFeesDue)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Lab / Materials expenses</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.labImplantMaterials)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Humm merchant fees</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.hummFees)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Afterpay merchant fees</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.afterpayFees)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Fees and costs total</td>
                <td style="padding:6px 0;text-align:right;">${money(feesAndCostsTotal)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Patient fees paid to Focus</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.feesPaidToFocus)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Patient fees received in error</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.feesPaidInError)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">Patient fees paid to another provider in error</td>
                <td style="padding:6px 0;text-align:right;">${money(autoTotals.feesOwed)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;">IV Facility Fees</td>
                <td style="padding:6px 0;text-align:right;">${money(manualInputs.ivFacilityFees)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0 0 0;font-weight:700;border-top:2px solid #0f172a;">
                  Final total due
                </td>
                <td style="padding:10px 0 0 0;text-align:right;font-weight:700;border-top:2px solid #0f172a;">
                  ${money(finalTotalDue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        ${sectionTable(
          "Implant / Materials entries",
          implantEntries,
          autoTotals.labImplantMaterials
        )}

        ${sectionTable(
          "Humm merchant fee entries",
          hummEntries,
          autoTotals.hummFees
        )}

        ${sectionTable(
          "Afterpay merchant fee entries",
          afterpayEntries,
          autoTotals.afterpayFees
        )}

        ${sectionTable(
          "Patient fees paid to Focus",
          paidToFocusEntries,
          autoTotals.feesPaidToFocus
        )}

        ${sectionTable(
          `Patient fees paid to ${provider.name} in error`,
          paidInErrorEntries,
          autoTotals.feesPaidInError
        )}
      </div>
    `;
  }

  async function emailStatementPreview(provider: Provider) {
    if (!selectedPeriodId) {
      showToast("Please select a billing period first.", "error");
      return;
    }

    if (!provider.email) {
      showToast("Provider email is missing.", "error");
      return;
    }

    const res = await fetch("/api/email-statement", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: provider.email,
        subject: `Statement Preview - ${provider.name}`,
        html: buildStatementPreviewHtml(provider),
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errorMessage =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message
          ? data.error.message
          : JSON.stringify(data?.error || "Failed to send statement email.");

      showToast(`Failed to send email: ${errorMessage}`, "error");
      return;
    }

    await writeAuditLog({
      action: "statement_preview_emailed",
      entityType: "provider",
      entityId: provider.id,
      billingPeriodId: selectedPeriodId,
      providerId: provider.id,
      metadata: { recipient_email: provider.email },
    });

    await writeStatementHistory({
      action: "emailed",
      billingPeriodId: selectedPeriodId,
      providerId: provider.id,
      recipientEmail: provider.email,
      metadata: { type: "preview" },
    });

    showToast("Statement preview emailed.", "success");
  }

  async function exportProviderStatements() {
    if (!selectedPeriodId) {
      showToast("Please select a billing period first.", "error");
      return;
    }

    const selectedPeriod = billingPeriods.find((p) => p.id === selectedPeriodId);
    if (!selectedPeriod) {
      showToast("Selected billing period not found.", "error");
      return;
    }

    if (loadingMetrics) {
      showToast("Imported values are still loading. Please wait.", "error");
      return;
    }

    setExporting(true);
    setMessage("");

    try {
      for (const provider of providers) {
        const {
          manualInputs,
          autoTotals,
          feeBase,
          serviceFee,
          gst,
          totalFeesDue,
          feesAndCostsTotal,
          finalTotalDue,
        } = getProviderCalculations(provider);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Statement", {
          views: [{ showGridLines: false }],
        });

        worksheet.columns = [
          { width: 40 },
          { width: 24 },
          { width: 14 },
          { width: 18 },
        ];

        await addLogoToWorksheet(workbook, worksheet);

        worksheet.mergeCells("A1:D1");
        worksheet.getCell("A1").value = "STATEMENT";
        worksheet.getCell("A1").font = { bold: true, size: 18 };
        worksheet.getCell("A1").alignment = {
          vertical: "middle",
          horizontal: "center",
        };

        worksheet.mergeCells("A2:D2");
        worksheet.getCell("A2").value = provider.name;
        worksheet.getCell("A2").font = { bold: true, size: 14 };
        worksheet.getCell("A2").alignment = { horizontal: "center" };

        worksheet.getCell("A4").value = PRACTICE.name;
        worksheet.getCell("A5").value = PRACTICE.address;
        worksheet.getCell("A6").value = `Ph: ${PRACTICE.phone}`;
        worksheet.getCell("A7").value = `Email: ${PRACTICE.email}`;
        worksheet.getCell("A8").value = `ABN ${PRACTICE.abn}`;
        worksheet.getCell("D4").value = "MONTH";
        worksheet.getCell("D5").value = selectedPeriod.label;
        worksheet.getCell("D4").font = { bold: true };
        worksheet.getCell("D5").font = { bold: true };
        worksheet.getCell("D4").alignment = { horizontal: "right" };
        worksheet.getCell("D5").alignment = { horizontal: "right" };

        let row = 9;
        row = 10;
        row = 11;

        for (const col of ["A", "B", "C", "D"]) {
          worksheet.getCell(`${col}${row}`).border = {
            bottom: { style: "medium", color: { argb: "FF000000" } },
          };
        }

        row += 1;

        worksheet.getCell(`A${row}`).value = "Activity";
        worksheet.getCell(`A${row}`).font = { bold: true, size: 11 };
        worksheet.getCell(`A${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDCEEFF" },
        };

        worksheet.mergeCells(`B${row}:D${row}`);
        worksheet.getCell(`B${row}`).value = "Payments";
        worksheet.getCell(`B${row}`).font = { bold: true, size: 12 };
        worksheet.getCell(`B${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDCEEFF" },
        };

        for (const col of ["A", "B", "C", "D"]) {
          worksheet.getCell(`${col}${row}`).border = {
            bottom: { style: "medium", color: { argb: "FF000000" } },
          };
        }

        row += 2;

        if (provider.service_fee_type === "tiered" && provider.tier_config?.length) {
          let previousLimit = 0;

          provider.tier_config.forEach((tier) => {
            const tierStart = previousLimit;
            const tierEnd = tier.up_to ?? feeBase;
            const tierAmount = Math.max(0, Math.min(feeBase, tierEnd) - tierStart);
            const tierFee = tierAmount * (tier.rate / 100);

            const label =
              tier.up_to === null
                ? `${tier.rate}% service fee on balance of net fees`
                : `${tier.rate}% of ${tier.up_to.toLocaleString("en-AU")}`;

            addLabeledValueRow(worksheet, row, label, tierFee);
            row += 1;
            previousLimit = tier.up_to ?? previousLimit;
          });
        } else {
          addLabeledValueRow(
            worksheet,
            row,
            `${provider.service_fee_percent}% service fee`,
            serviceFee
          );
          row += 1;
        }

        addLabeledValueRow(worksheet, row, "Service fee", serviceFee, {
          bold: true,
        });
        row += 1;
        addLabeledValueRow(worksheet, row, "Plus GST", gst);
        row += 1;
        addLabeledValueRow(worksheet, row, "Total fees due", totalFeesDue, {
          bold: true,
        });
        row += 2;

        worksheet.getCell(`A${row}`).value = "Add";
        worksheet.getCell(`A${row}`).font = { bold: true };
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Lab / Materials expenses",
          autoTotals.labImplantMaterials
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Humm merchant fees",
          autoTotals.hummFees
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Fees and costs total",
          feesAndCostsTotal,
          { bold: true }
        );
        row += 2;

        worksheet.getCell(`A${row}`).value =
          "ADJUSTMENTS FOR PATIENT FEES (NO GST INCLUDED)";
        worksheet.getCell(`A${row}`).font = { bold: true };
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Patient fees paid to Focus",
          autoTotals.feesPaidToFocus
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          `Plus Patient fees received by ${provider.name} in error`,
          autoTotals.feesPaidInError
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Patient fees paid to another provider in error",
          autoTotals.feesOwed
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Plus IV Facility Fees",
          manualInputs.ivFacilityFees
        );
        row += 1;

        addLabeledValueRow(worksheet, row, "FINAL TOTAL DUE", finalTotalDue, {
          bold: true,
        });

        for (const col of ["A", "B", "C", "D"]) {
          worksheet.getCell(`${col}${row}`).border = {
            top: { style: "medium", color: { argb: "FF000000" } },
            bottom: { style: "medium", color: { argb: "FF000000" } },
          };
        }

        row += 3;

        worksheet.getCell(`A${row}`).value = "Patient Billings";
        worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Gross Production",
          manualInputs.grossProduction
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient Billings Adjustments",
          manualInputs.adjustments
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Implants, Materials and Lab Expenses",
          autoTotals.labImplantMaterials
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Afterpay and Humm Merchant Fees",
          autoTotals.afterpayFees + autoTotals.hummFees
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less IV Facility Fees",
          manualInputs.ivFacilityFees
        );
        row += 1;

        addLabeledValueRow(worksheet, row, "NET PATIENT FEES", feeBase, {
          bold: true,
        });
        row += 2;

        worksheet.getCell(`A${row}`).value = "Tracking";
        worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient Fees Paid to Focus",
          autoTotals.feesPaidToFocus
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient Fees Received in Error",
          autoTotals.feesPaidInError
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient fees paid to another provider in error",
          autoTotals.feesOwed
        );
        row += 3;

        const providerPatientEntries = entries.filter(
          (entry) => entry.provider_id === provider.id
        );

        const providerDetailEntries = billingDetailEntries.filter(
          (entry) => entry.provider_id === provider.id
        );

        function addSectionHeader(title: string) {
          const cell = worksheet.getCell(`A${row}`);
          cell.value = title;
          cell.font = { bold: true, size: 11 };
          cell.border = {
            bottom: { style: "thin", color: { argb: "FF999999" } },
          };
          row += 1;
        }

        function addNilRow() {
          worksheet.getCell(`A${row}`).value = "Nil";
          worksheet.getCell(`A${row}`).font = { italic: true };
          row += 1;
        }

        function addLine(label: string, amount: number) {
          worksheet.getCell(`A${row}`).value = label;
          worksheet.getCell(`D${row}`).value = amount;
          worksheet.getCell(`D${row}`).numFmt = "#,##0.00";
          worksheet.getCell(`D${row}`).alignment = { horizontal: "right" };
          worksheet.getCell(`A${row}`).font = { size: 10 };
          worksheet.getCell(`D${row}`).font = { size: 10 };
          row += 1;
        }

        function addSubtotal(amount: number) {
          worksheet.getCell(`C${row}`).value = "Total";
          worksheet.getCell(`C${row}`).font = { bold: true };
          worksheet.getCell(`D${row}`).value = amount;
          worksheet.getCell(`D${row}`).numFmt = "#,##0.00";
          worksheet.getCell(`D${row}`).alignment = { horizontal: "right" };
          worksheet.getCell(`D${row}`).font = { bold: true, size: 11 };

          worksheet.getCell(`C${row}`).border = {
            top: { style: "thin", color: { argb: "FF000000" } },
          };
          worksheet.getCell(`D${row}`).border = {
            top: { style: "thin", color: { argb: "FF000000" } },
          };

          row += 2;
        }

        addSectionHeader("Implant/Grafting Materials/Guides NET excluding GST");

        const implantEntries = providerPatientEntries.filter(
          (e) => e.category === "lab_implant_materials"
        );

        let implantTotal = 0;

        if (implantEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          implantEntries.forEach((e) => {
            const label = `${e.patient_name || "Unknown"}${e.notes ? " " + e.notes : ""}`;
            addLine(label, e.amount);
            implantTotal += e.amount;
          });
          addSubtotal(implantTotal);
        }

        addSectionHeader("Afterpay Merchant Fees NET excluding GST");

        const afterpayEntries = providerDetailEntries.filter(
          (e) => e.category === "afterpay_fee"
        );

        let afterpayTotal = 0;

        if (afterpayEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          afterpayEntries.forEach((e) => {
            const label = `${e.patient_name || ""}${e.notes ? " " + e.notes : ""}`;
            addLine(label.trim(), e.amount);
            afterpayTotal += e.amount;
          });
          addSubtotal(afterpayTotal);
        }

        addSectionHeader("Humm Merchant Fees NET excluding GST");

        const hummEntries = providerDetailEntries.filter(
          (e) => e.category === "humm_fee"
        );

        let hummTotal = 0;

        if (hummEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          hummEntries.forEach((e) => {
            const label = `${e.patient_name || ""}${e.notes ? " " + e.notes : ""}`;
            addLine(label.trim(), e.amount);
            hummTotal += e.amount;
          });
          addSubtotal(hummTotal);
        }

        addSectionHeader("IV Facility Fees Payable to Focus NET");

        if (manualInputs.ivFacilityFees === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          addLine("Monthly IV facility fees", manualInputs.ivFacilityFees);
          addSubtotal(manualInputs.ivFacilityFees);
        }

        addSectionHeader("Patient fees paid to Focus");

        const paidToFocusEntries = providerPatientEntries.filter(
          (e) => e.category === "fees_paid_to_focus"
        );

        let focusTotal = 0;

        if (paidToFocusEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          paidToFocusEntries.forEach((e) => {
            const label = `${e.patient_name || ""}${e.notes ? " " + e.notes : ""}`;
            addLine(label, e.amount);
            focusTotal += e.amount;
          });
          addSubtotal(focusTotal);
        }

        addSectionHeader(`Patient fees paid to ${provider.name} in error`);

        const paidToThisProviderInErrorEntries = providerPatientEntries.filter(
          (e) => e.category === "paid_to_wrong_provider"
        );

        let paidToThisProviderInErrorTotal = 0;

        if (paidToThisProviderInErrorEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          paidToThisProviderInErrorEntries.forEach((e) => {
            const owedProviderName =
              providers.find((p) => p.id === e.related_provider_id)?.name ||
              "Unknown provider";

            const label = `${e.patient_name || ""}${
              e.notes ? " " + e.notes : ""
            }${owedProviderName ? ` (Owed to: ${owedProviderName})` : ""}`;

            addLine(label, e.amount);
            paidToThisProviderInErrorTotal += e.amount;
          });
          addSubtotal(paidToThisProviderInErrorTotal);
        }

        addSectionHeader("Patient fees paid to another provider in error");

        const paidToAnotherProviderEntries = entries.filter(
          (e) =>
            e.category === "paid_to_wrong_provider" &&
            e.related_provider_id === provider.id &&
            e.billing_period_id === selectedPeriodId
        );

        let paidToAnotherProviderTotal = 0;

        if (paidToAnotherProviderEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          paidToAnotherProviderEntries.forEach((e) => {
            const paidProviderName =
              providers.find((p) => p.id === e.provider_id)?.name ||
              "Unknown provider";

            const label = `${e.patient_name || ""}${
              e.notes ? " " + e.notes : ""
            }${paidProviderName ? ` (Paid to: ${paidProviderName})` : ""}`;

            addLine(label, e.amount);
            paidToAnotherProviderTotal += e.amount;
          });
          addSubtotal(paidToAnotherProviderTotal);
        }

        for (let r = 1; r <= row; r++) {
          worksheet.getRow(r).eachCell((cell) => {
            if (typeof cell.value === "number") {
              cell.numFmt = "#,##0.00";
            }
          });
        }

        ["A1:D1", "A2:D2"].forEach((range) => {
          const cell = worksheet.getCell(range.split(":")[0]);
          cell.alignment = { horizontal: "center" };
        });

        worksheet.getColumn(4).alignment = { horizontal: "right" };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        const fileName = `${sanitizeFileName(provider.name)}_${sanitizeFileName(
          selectedPeriod.label
        )}_statement.xlsx`;

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        await writeAuditLog({
          action: "statement_exported",
          entityType: "provider",
          entityId: provider.id,
          billingPeriodId: selectedPeriodId,
          providerId: provider.id,
          metadata: { fileName },
        });

        await writeStatementHistory({
          action: "exported",
          billingPeriodId: selectedPeriodId,
          providerId: provider.id,
          metadata: { fileName },
        });

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      showToast("Provider statements exported.", "success");
    } catch (error: any) {
      showToast(`Export failed: ${error?.message || "Unknown error"}`, "error");
    } finally {
      setExporting(false);
    }
  }

  const actionsDisabled =
    !selectedPeriodId ||
    activePeriodStatus === "locked" ||
    loadingMetrics ||
    savingAll;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <ConfirmDialog
          open={confirmOpen}
          title={confirmTitle}
          description={confirmDescription}
          danger={confirmDanger}
          onCancel={() => {
            setConfirmOpen(false);
            setConfirmAction(null);
          }}
          onConfirm={() => {
            confirmAction?.();
            setConfirmOpen(false);
            setConfirmAction(null);
          }}
        />

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Monthly Billing</h1>
            <p className="mt-1 text-sm text-slate-600">
              Enter monthly values for each provider and calculate service fees.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/imports/upload"
              className="rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Import Production Report
            </Link>

            <button
              onClick={createNextBillingPeriod}
              className="rounded-2xl border bg-white px-4 py-2 hover:bg-slate-100"
            >
              Add New Month
            </button>

            <button
              onClick={() =>
                openConfirm({
                  title:
                    activePeriodStatus === "locked"
                      ? "Unlock billing month?"
                      : "Lock billing month?",
                  description:
                    activePeriodStatus === "locked"
                      ? "This will reopen the month and allow edits again."
                      : "This will lock the month and prevent further edits until reopened.",
                  action: () => {
                    toggleBillingPeriodLock();
                  },
                })
              }
              disabled={!selectedPeriodId}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {activePeriodStatus === "locked" ? "Unlock Month" : "Lock Month"}
            </button>

            <button
              onClick={() =>
                openConfirm({
                  title: "Save all provider records?",
                  description:
                    "This will save the current billing values for every provider in the selected month.",
                  action: () => {
                    saveAllProviderRecords();
                  },
                })
              }
              disabled={actionsDisabled}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingAll ? "Saving All..." : "Save All"}
            </button>

            <button
              onClick={exportProviderStatements}
              disabled={!selectedPeriodId || exporting || loadingMetrics}
              className="rounded-2xl border bg-white px-4 py-2 hover:bg-slate-100 disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export Provider Statements"}
            </button>
          </div>
        </div>

        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm">Billing period</label>
          <select
            className="w-full rounded-2xl border bg-white px-3 py-2"
            value={selectedPeriodId}
            onChange={(e) => {
              const value = e.target.value;
              setSelectedPeriodId(value);
              loadData(value);
            }}
          >
            <option value="">Select billing period</option>
            {billingPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </select>

          <div className="mt-2 text-sm text-slate-600">
            Status: <StatusBadge status={activePeriodStatus} />
          </div>
        </div>

        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm">Logo source</label>
          <div className="rounded-2xl border bg-white px-3 py-2 text-sm text-slate-600">
            Automatically loaded from Supabase Storage: branding/logo.png
          </div>
        </div>

        {loadingMetrics && (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Loading imported production values for this billing period. Gross production
            and IV Facility Fees may appear blank until loading is complete.
          </div>
        )}

        {activePeriodStatus === "locked" && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            This billing period is locked. Values cannot be changed until it is reopened.
          </div>
        )}

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={toastTone} />
          </div>
        )}

        <div className="mt-6 space-y-6">
          {providers.map((provider) => {
            const manualInputs = manualBillingData[provider.id] || emptyManualInputs;
            const autoTotals = autoTotalsByProvider[provider.id] || {
              labImplantMaterials: 0,
              feesPaidToFocus: 0,
              feesPaidInError: 0,
              feesOwed: 0,
              hummFees: 0,
              afterpayFees: 0,
            };

            const feeBase = calculateFeeBase(provider, manualInputs, autoTotals);
            const serviceFee = calculateServiceFee(provider, feeBase);
            const gst = serviceFee * 0.1;
            const totalFeesDue = serviceFee + gst;
            const feesAndCostsTotal =
              totalFeesDue + autoTotals.hummFees + autoTotals.labImplantMaterials;
            const finalTotalDue =
              feesAndCostsTotal -
              autoTotals.feesPaidToFocus +
              autoTotals.feesOwed -
              autoTotals.feesPaidInError +
              manualInputs.ivFacilityFees;

            const importedFieldsLoading = loadingMetrics && !savedRecords[provider.id];

            return (
              <div
                key={provider.id}
                className="rounded-3xl border bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{provider.name}</h2>
                    <p className="text-sm text-slate-600">{provider.specialty}</p>
                    {provider.email && (
                      <p className="mt-1 text-xs text-slate-500">{provider.email}</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        openConfirm({
                          title: "Email statement preview?",
                          description: provider.email
                            ? `This will email a statement preview to ${provider.email}.`
                            : "This provider does not have an email address saved yet.",
                          action: () => {
                            emailStatementPreview(provider);
                          },
                        })
                      }
                      disabled={!selectedPeriodId || loadingMetrics}
                      className="rounded-2xl border px-4 py-2 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Email Preview
                    </button>

                    <button
                      onClick={() => saveProviderRecord(provider.id)}
                      disabled={
                        !selectedPeriodId ||
                        savingProviderId === provider.id ||
                        activePeriodStatus === "locked" ||
                        loadingMetrics ||
                        savingAll
                      }
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingProviderId === provider.id ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm">Gross production</label>
                    <input
                      type="number"
                      disabled={activePeriodStatus === "locked" || loadingMetrics}
                      className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                      value={
                        importedFieldsLoading
                          ? ""
                          : manualInputs.grossProduction === 0
                          ? ""
                          : manualInputs.grossProduction
                      }
                      placeholder={
                        importedFieldsLoading ? "Loading..." : "0"
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        updateManualBilling(
                          provider.id,
                          "grossProduction",
                          val === "" ? 0 : Number(val)
                        );
                      }}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-filled from imported production report for this billing period
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Adjustments</label>
                    <input
                      type="number"
                      disabled={activePeriodStatus === "locked"}
                      className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                      value={manualInputs.adjustments === 0 ? "" : manualInputs.adjustments}
                      placeholder="0"
                      onChange={(e) => {
                        const val = e.target.value;
                        updateManualBilling(
                          provider.id,
                          "adjustments",
                          val === "" ? 0 : Number(val)
                        );
                      }}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Incorrect payments</label>
                    <input
                      type="number"
                      disabled={activePeriodStatus === "locked"}
                      className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                      value={
                        manualInputs.incorrectPayments === 0
                          ? ""
                          : manualInputs.incorrectPayments
                      }
                      placeholder="0"
                      onChange={(e) => {
                        const val = e.target.value;
                        updateManualBilling(
                          provider.id,
                          "incorrectPayments",
                          val === "" ? 0 : Number(val)
                        );
                      }}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Tracking only, not deducted from fee base
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Humm merchant fees</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border bg-slate-100 px-3 py-2"
                      value={autoTotals.hummFees}
                      readOnly
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-filled from Billing Detail Entries
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Afterpay merchant fees</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border bg-slate-100 px-3 py-2"
                      value={autoTotals.afterpayFees}
                      readOnly
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-filled from Billing Detail Entries
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">IV Facility Fees</label>
                    <input
                      type="number"
                      disabled={activePeriodStatus === "locked" || loadingMetrics}
                      className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                      value={
                        importedFieldsLoading
                          ? ""
                          : manualInputs.ivFacilityFees === 0
                          ? ""
                          : manualInputs.ivFacilityFees
                      }
                      placeholder={
                        importedFieldsLoading ? "Loading..." : "0"
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        updateManualBilling(
                          provider.id,
                          "ivFacilityFees",
                          val === "" ? 0 : Number(val)
                        );
                      }}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-filled from imported production report item code 949
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">
                      Lab, Implants & Materials Expenses
                    </label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border bg-slate-100 px-3 py-2"
                      value={autoTotals.labImplantMaterials}
                      readOnly
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-filled from Patient Financial Entries
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Other Deductions</label>
                    <input
                      type="number"
                      disabled={activePeriodStatus === "locked"}
                      className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                      value={
                        manualInputs.otherDeductions === 0
                          ? ""
                          : manualInputs.otherDeductions
                      }
                      placeholder="0"
                      onChange={(e) => {
                        const val = e.target.value;
                        updateManualBilling(
                          provider.id,
                          "otherDeductions",
                          val === "" ? 0 : Number(val)
                        );
                      }}
                    />
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 p-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <div className="text-sm text-slate-500">Fee base</div>
                      <div className="text-2xl font-semibold">${currency(feeBase)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">Service fee</div>
                      <div className="text-2xl font-semibold">${currency(serviceFee)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">GST (10%)</div>
                      <div className="text-2xl font-semibold">${currency(gst)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">Total fees due</div>
                      <div className="text-2xl font-semibold">${currency(totalFeesDue)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">Fees and costs total</div>
                      <div className="text-2xl font-semibold">
                        ${currency(feesAndCostsTotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">Final total due</div>
                      <div className="text-2xl font-semibold">${currency(finalTotalDue)}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border bg-white p-4">
                  <div className="text-sm text-slate-500">Patient fee tracking only</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs text-slate-500">Paid to Focus</div>
                      <div className="text-lg font-semibold">
                        ${currency(autoTotals.feesPaidToFocus)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Received in Error</div>
                      <div className="text-lg font-semibold">
                        ${currency(autoTotals.feesPaidInError)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        Paid to Another Provider in Error
                      </div>
                      <div className="text-lg font-semibold">
                        ${currency(autoTotals.feesOwed)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-sm text-slate-500">
                  Formula type: {provider.service_fee_type}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}