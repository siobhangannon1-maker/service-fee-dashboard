"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateServiceFee } from "@/lib/calculations";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import ExcelJS from "exceljs";

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
};

type ProviderMonthlyRecord = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  gross_production: number;
  adjustments: number;
  incorrect_payments: number;
  iv_facility_fees: number;
  afterpay_fees: number;
  humm_fees: number;
  other_deductions?: number | null;
};

type ManualBillingInputs = {
  grossProduction: number;
  adjustments: number;
  incorrectPayments: number;
  hummFees: number;
  afterpayFees: number;
  ivFacilityFees: number;
  otherDeductions: number;
};

type AutoTotals = {
  labImplantMaterials: number;
  feesPaidToFocus: number;
  feesPaidInError: number;
  feesOwed: number;
};

const emptyManualInputs: ManualBillingInputs = {
  grossProduction: 0,
  adjustments: 0,
  incorrectPayments: 0,
  hummFees: 0,
  afterpayFees: 0,
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
  const [entries, setEntries] = useState<PatientFinancialEntry[]>([]);
  const [billingDetailEntries, setBillingDetailEntries] = useState<BillingDetailEntry[]>([]);
  const [manualBillingData, setManualBillingData] = useState<
    Record<string, ManualBillingInputs>
  >({});
  const [savedRecords, setSavedRecords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  async function loadData(periodId?: string) {
    setMessage("");

    const { data: providerData, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .order("name");

    if (providerError) {
      setMessage(`Error loading providers: ${providerError.message}`);
      return;
    }

    const { data: periodData, error: periodError } = await supabase
      .from("billing_periods")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (periodError) {
      setMessage(`Error loading billing periods: ${periodError.message}`);
      return;
    }

    const providerList = (providerData || []) as Provider[];
    const periodList = (periodData || []) as BillingPeriod[];

    setProviders(providerList);
    setBillingPeriods(periodList);

    const activePeriodId = periodId || selectedPeriodId || periodList[0]?.id || "";

    if (activePeriodId && activePeriodId !== selectedPeriodId) {
      setSelectedPeriodId(activePeriodId);
    }

    let entryQuery = supabase.from("patient_financial_entries").select("*");
    if (activePeriodId) {
      entryQuery = entryQuery.eq("billing_period_id", activePeriodId);
    }

    const { data: entryData, error: entryError } = await entryQuery;

    if (entryError) {
      setMessage(`Error loading patient entries: ${entryError.message}`);
      return;
    }

    setEntries((entryData || []) as PatientFinancialEntry[]);

    let detailQuery = supabase.from("billing_detail_entries").select("*");
    if (activePeriodId) {
      detailQuery = detailQuery.eq("billing_period_id", activePeriodId);
    }

    const { data: detailData, error: detailError } = await detailQuery;

    if (detailError) {
      setMessage(`Error loading billing detail entries: ${detailError.message}`);
      return;
    }

    setBillingDetailEntries((detailData || []) as BillingDetailEntry[]);

    let recordQuery = supabase.from("provider_monthly_records").select("*");
    if (activePeriodId) {
      recordQuery = recordQuery.eq("billing_period_id", activePeriodId);
    }

    const { data: recordData, error: recordError } = await recordQuery;

    if (recordError) {
      setMessage(`Error loading monthly records: ${recordError.message}`);
      return;
    }

    const records = (recordData || []) as ProviderMonthlyRecord[];

    const nextManualData: Record<string, ManualBillingInputs> = {};
    const nextSavedRecords: Record<string, string> = {};

    providerList.forEach((provider) => {
      const record = records.find((r) => r.provider_id === provider.id);

      nextManualData[provider.id] = record
        ? {
            grossProduction: Number(record.gross_production || 0),
            adjustments: Number(record.adjustments || 0),
            incorrectPayments: Number(record.incorrect_payments || 0),
            hummFees: Number(record.humm_fees || 0),
            afterpayFees: Number(record.afterpay_fees || 0),
            ivFacilityFees: Number(record.iv_facility_fees || 0),
            otherDeductions: Number(record.other_deductions || 0),
          }
        : { ...emptyManualInputs };

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

  async function saveProviderRecord(providerId: string) {
    if (!selectedPeriodId) {
      setMessage("Please select a billing period first.");
      return;
    }

    const inputs = manualBillingData[providerId] || emptyManualInputs;
    setSavingProviderId(providerId);
    setMessage("");

    const payload = {
      provider_id: providerId,
      billing_period_id: selectedPeriodId,
      gross_production: inputs.grossProduction,
      adjustments: inputs.adjustments,
      incorrect_payments: inputs.incorrectPayments,
      iv_facility_fees: inputs.ivFacilityFees,
      afterpay_fees: inputs.afterpayFees,
      humm_fees: inputs.hummFees,
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
      setMessage(`Save failed: ${result.error.message}`);
      setSavingProviderId(null);
      return;
    }

    if (!existingId && "data" in result && result.data?.id) {
      setSavedRecords((prev) => ({ ...prev, [providerId]: result.data.id }));
    }

    setMessage("Billing values saved.");
    setSavingProviderId(null);
  }

  const autoTotalsByProvider = useMemo(() => {
    const totals: Record<string, AutoTotals> = {};

    for (const provider of providers) {
      totals[provider.id] = {
        labImplantMaterials: 0,
        feesPaidToFocus: 0,
        feesPaidInError: 0,
        feesOwed: 0,
      };
    }

    for (const entry of entries) {
      if (!totals[entry.provider_id]) {
        totals[entry.provider_id] = {
          labImplantMaterials: 0,
          feesPaidToFocus: 0,
          feesPaidInError: 0,
          feesOwed: 0,
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
            };
          }
          totals[entry.related_provider_id].feesOwed += amount;
        }
      }
    }

    return totals;
  }, [entries, providers]);

  function calculateFeeBase(
    provider: Provider,
    manualInputs: ManualBillingInputs,
    autoTotals: AutoTotals
  ) {
    return (
      manualInputs.grossProduction -
      (provider.deduct_adjustments ? manualInputs.adjustments : 0) -
      manualInputs.hummFees -
      manualInputs.afterpayFees -
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
    };

    const feeBase = calculateFeeBase(provider, manualInputs, autoTotals);
    const serviceFee = calculateServiceFee(provider, feeBase);
    const gst = serviceFee * 0.1;
    const totalFeesDue = serviceFee + gst;
    const feesAndCostsTotal =
      totalFeesDue + manualInputs.hummFees + autoTotals.labImplantMaterials;
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

  async function exportProviderStatements() {
    if (!selectedPeriodId) {
      setMessage("Please select a billing period first.");
      return;
    }

    const selectedPeriod = billingPeriods.find((p) => p.id === selectedPeriodId);
    if (!selectedPeriod) {
      setMessage("Selected billing period not found.");
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

        worksheet.getCell(`A${row}`).value = "Activity";
        worksheet.getCell(`A${row}`).font = { bold: true, size: 11 };
        worksheet.getCell(`A${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDCEEFF" },
        };

        worksheet.getCell(`B${row}`).value = "Payments";
        worksheet.getCell(`B${row}`).font = { bold: true, size: 11 };
        worksheet.getCell(`B${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDCEEFF" },
        };

        worksheet.getCell(`D${row}`).value = "Amount";
        worksheet.getCell(`D${row}`).font = { bold: true, size: 11 };
        worksheet.getCell(`D${row}`).alignment = { horizontal: "right" };
        worksheet.getCell(`D${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDCEEFF" },
        };

        for (const col of ["A", "B", "C", "D"]) {
          worksheet.getCell(`${col}${row}`).border = {
            bottom: { style: "medium", color: { argb: "FF000000" } },
          };
        }

        row += 1;

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
          manualInputs.hummFees
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
          autoTotals.feesOwed
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Patient fees paid to another provider in error",
          autoTotals.feesPaidInError
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
          "Gross production",
          manualInputs.grossProduction
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient Billings adjustment",
          manualInputs.adjustments
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Implants & Lab exp",
          autoTotals.labImplantMaterials
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Afterpay fees",
          manualInputs.afterpayFees
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Less Facility Fees",
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
          "Patient fees paid to Focus",
          autoTotals.feesPaidToFocus
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient fees received in error",
          autoTotals.feesOwed
        );
        row += 1;

        addLabeledValueRow(
          worksheet,
          row,
          "Patient fees paid to another provider in error",
          autoTotals.feesPaidInError
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

        addSectionHeader("Afterpay and Zipmoney NET excluding GST");

        const merchantEntries = providerDetailEntries.filter(
          (e) => e.category === "humm_fee" || e.category === "afterpay_fee"
        );

        let merchantTotal = 0;

        if (merchantEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          merchantEntries.forEach((e) => {
            const label = `${e.patient_name || ""}${e.patient_name ? " " : ""}${
              e.category === "humm_fee" ? "Humm" : "Afterpay"
            }${e.notes ? " " + e.notes : ""}`;
            addLine(label.trim(), e.amount);
            merchantTotal += e.amount;
          });
          addSubtotal(merchantTotal);
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

        const paidInErrorEntries = providerPatientEntries.filter(
          (e) =>
            e.category === "fees_paid_in_error" ||
            e.category === "paid_to_wrong_provider"
        );

        let errorTotal = 0;

        if (paidInErrorEntries.length === 0) {
          addNilRow();
          addSubtotal(0);
        } else {
          paidInErrorEntries.forEach((e) => {
            const label = `${e.patient_name || ""}${e.notes ? " " + e.notes : ""}`;
            addLine(label, e.amount);
            errorTotal += e.amount;
          });
          addSubtotal(errorTotal);
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

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      setMessage("Provider statements exported.");
    } catch (error: any) {
      setMessage(`Export failed: ${error?.message || "Unknown error"}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Monthly Billing</h1>
            <p className="mt-1 text-sm text-slate-600">
              Enter monthly values for each provider and calculate service fees.
            </p>
          </div>

          <button
            onClick={exportProviderStatements}
            disabled={!selectedPeriodId || exporting}
            className="rounded-2xl border bg-white px-4 py-2 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export Provider Statements"}
          </button>
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
        </div>

        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm">Logo source</label>
          <div className="rounded-2xl border bg-white px-3 py-2 text-sm text-slate-600">
            Automatically loaded from Supabase Storage: branding/logo.png
          </div>
        </div>

        {message && (
          <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
            {message}
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
            };

            const feeBase = calculateFeeBase(provider, manualInputs, autoTotals);
            const serviceFee = calculateServiceFee(provider, feeBase);
            const gst = serviceFee * 0.1;
            const totalFeesDue = serviceFee + gst;
            const feesAndCostsTotal =
              totalFeesDue + manualInputs.hummFees + autoTotals.labImplantMaterials;
            const finalTotalDue =
              feesAndCostsTotal -
              autoTotals.feesPaidToFocus +
              autoTotals.feesOwed -
              autoTotals.feesPaidInError +
              manualInputs.ivFacilityFees;

            return (
              <div
                key={provider.id}
                className="rounded-3xl border bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{provider.name}</h2>
                    <p className="text-sm text-slate-600">{provider.specialty}</p>
                  </div>

                  <button
                    onClick={() => saveProviderRecord(provider.id)}
                    disabled={!selectedPeriodId || savingProviderId === provider.id}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {savingProviderId === provider.id ? "Saving..." : "Save"}
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm">Gross production</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.grossProduction}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "grossProduction",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Adjustments</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.adjustments}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "adjustments",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Incorrect payments</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.incorrectPayments}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "incorrectPayments",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Tracking only, not deducted from fee base
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Humm merchant fees</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.hummFees}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "hummFees",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Afterpay merchant fees</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.afterpayFees}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "afterpayFees",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">IV Facility Fees</label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.ivFacilityFees}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "ivFacilityFees",
                          Number(e.target.value) || 0
                        )
                      }
                    />
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
                      className="w-full rounded-2xl border px-3 py-2"
                      value={manualInputs.otherDeductions}
                      onChange={(e) =>
                        updateManualBilling(
                          provider.id,
                          "otherDeductions",
                          Number(e.target.value) || 0
                        )
                      }
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
                        ${currency(autoTotals.feesOwed)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        Paid to Another Provider in Error
                      </div>
                      <div className="text-lg font-semibold">
                        ${currency(autoTotals.feesPaidInError)}
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