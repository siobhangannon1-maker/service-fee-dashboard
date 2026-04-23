"use client";

import Link from "next/link";
import { ensureCurrentBillingPeriod } from "@/lib/billingPeriods";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/audit";
import Toast from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type Provider = {
  id: string;
  name: string;
};

type BillingPeriod = {
  id: string;
  label: string;
  status: string;
  month: number;
  year: number;
};

type MaterialCostItem = {
  id: string;
  name: string;
  default_cost: number;
  is_active: boolean;
  sort_order: number;
  ref_codes: string[] | null;
  barcode_values: string[] | null;
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
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  verified_by_initials?: string | null;
  is_review_locked?: boolean;
};

type EntryForm = {
  provider_id: string;
  related_provider_id: string;
  billing_period_id: string;
  patient_name: string;
  entry_date: string;
  category: EntryCategory;
  amount: string;
  notes: string;
};

type EntryCreatorInfo = {
  userId: string;
  displayName: string;
  initials: string;
};

type ScanMatchResult =
  | {
      status: "matched";
      item: MaterialCostItem;
      detectedValue: string;
      source: "barcode" | "ocr";
    }
  | {
      status: "multiple";
      matches: MaterialCostItem[];
      detectedValue: string;
      source: "barcode" | "ocr";
    }
  | {
      status: "none";
      detectedValue: string;
      source: "barcode" | "ocr";
    };

const emptyForm: EntryForm = {
  provider_id: "",
  related_provider_id: "",
  billing_period_id: "",
  patient_name: "",
  entry_date: new Date().toISOString().slice(0, 10),
  category: "lab_implant_materials",
  amount: "",
  notes: "",
};

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const BADGE_COLOR_CLASSES = [
  "bg-rose-100 text-rose-700 ring-rose-200",
  "bg-blue-100 text-blue-700 ring-blue-200",
  "bg-emerald-100 text-emerald-700 ring-emerald-200",
  "bg-amber-100 text-amber-700 ring-amber-200",
  "bg-violet-100 text-violet-700 ring-violet-200",
  "bg-cyan-100 text-cyan-700 ring-cyan-200",
  "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200",
  "bg-lime-100 text-lime-700 ring-lime-200",
];

function getDefaultBillingPeriodId(periods: BillingPeriod[]) {
  if (!periods.length) return "";

  const today = new Date();
  const currentMonth = today.getMonth() + 1;

  const years = Array.from(new Set(periods.map((p) => p.year))).sort(
    (a, b) => b - a
  );
  const latestYear = years[0];

  const currentMonthInLatestYear = periods.find(
    (p) => p.year === latestYear && p.month === currentMonth
  );
  if (currentMonthInLatestYear) {
    return currentMonthInLatestYear.id;
  }

  const firstMonthInLatestYear = periods
    .filter((p) => p.year === latestYear)
    .sort((a, b) => a.month - b.month)[0];

  return firstMonthInLatestYear?.id || periods[0]?.id || "";
}

function getYearsDescending(periods: BillingPeriod[]) {
  return Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);
}

function getMonthsAscendingForYear(periods: BillingPeriod[], year: number) {
  return Array.from(
    new Set(periods.filter((p) => p.year === year).map((p) => p.month))
  ).sort((a, b) => a - b);
}

function getPeriodIdFromYearMonth(
  periods: BillingPeriod[],
  year: number,
  month: number
) {
  return periods.find((p) => p.year === year && p.month === month)?.id || "";
}

function getFallbackPeriodIdForYear(periods: BillingPeriod[], year: number) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;

  const currentMonthPeriod = periods.find(
    (p) => p.year === year && p.month === currentMonth
  );
  if (currentMonthPeriod) {
    return currentMonthPeriod.id;
  }

  const firstMonthPeriod = periods
    .filter((p) => p.year === year)
    .sort((a, b) => a.month - b.month)[0];

  return firstMonthPeriod?.id || "";
}

function getBadgeColorClass(seed: string) {
  let hash = 0;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return BADGE_COLOR_CLASSES[hash % BADGE_COLOR_CLASSES.length];
}

function formatCurrency(value: number) {
  return Number(value).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/REF[:\s-]*/g, "")
    .replace(/CAT[:\s#-]*/g, "")
    .replace(/CATALOG[:\s#-]*/g, "")
    .replace(/SKU[:\s#-]*/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getItemCodes(item: MaterialCostItem) {
  const refCodes = item.ref_codes || [];
  const barcodeValues = item.barcode_values || [];

  return uniqueStrings([...refCodes, ...barcodeValues]).map((value) =>
    normalizeCode(value)
  );
}

function extractCandidatesFromText(text: string) {
  const upperText = text.toUpperCase();

  const regexes = [
    /(?:REF|CAT|CATALOG|SKU)[\s:#-]*([A-Z0-9][A-Z0-9\-\/.]{2,})/g,
    /\b\d{8,18}\b/g,
    /\b[A-Z]{1,4}\d{3,}\b/g,
    /\b\d{2,}[A-Z]{1,4}\d*\b/g,
    /\b[A-Z0-9\-\/.]{4,}\b/g,
  ];

  const results: string[] = [];

  for (const regex of regexes) {
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(upperText)) !== null) {
      const value = match[1] || match[0];
      const normalized = normalizeCode(value);
      if (normalized.length >= 4) {
        results.push(normalized);
      }
    }
  }

  return uniqueStrings(results);
}

function findMaterialMatches(
  detectedValue: string,
  materialItems: MaterialCostItem[],
  source: "barcode" | "ocr"
): ScanMatchResult {
  const normalizedDetectedValue = normalizeCode(detectedValue);

  if (!normalizedDetectedValue) {
    return {
      status: "none",
      detectedValue,
      source,
    };
  }

  const exactMatches = materialItems.filter((item) =>
    getItemCodes(item).includes(normalizedDetectedValue)
  );

  if (exactMatches.length === 1) {
    return {
      status: "matched",
      item: exactMatches[0],
      detectedValue,
      source,
    };
  }

  if (exactMatches.length > 1) {
    return {
      status: "multiple",
      matches: exactMatches,
      detectedValue,
      source,
    };
  }

  return {
    status: "none",
    detectedValue,
    source,
  };
}

async function scanBarcodeFromImage(file: File) {
  try {
    const zxing = await import("@zxing/browser");
    const reader = new zxing.BrowserMultiFormatReader();

    const imageUrl = URL.createObjectURL(file);

    try {
      const img = document.createElement("img");
      img.src = imageUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image could not be loaded."));
      });

      const result = await reader.decodeFromImageElement(img);
      return result.getText();
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  } catch {
    return null;
  }
}

async function scanTextFromImage(file: File) {
  try {
    const Tesseract = await import("tesseract.js");
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {},
    });

    return result.data.text || "";
  } catch {
    return "";
  }
}

export default function PatientEntriesPage() {
  const supabase = createClient();
  const formRef = useRef<HTMLFormElement | null>(null);
  const materialDropdownRef = useRef<HTMLDivElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialDropdownOpen, setMaterialDropdownOpen] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatusText, setScanStatusText] = useState("");
  const [scanDetectedValue, setScanDetectedValue] = useState("");
  const [scanCandidateMatches, setScanCandidateMatches] = useState<
    MaterialCostItem[]
  >([]);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [materialItems, setMaterialItems] = useState<MaterialCostItem[]>([]);
  const [entries, setEntries] = useState<PatientFinancialEntry[]>([]);
  const [entryCreators, setEntryCreators] = useState<
    Record<string, EntryCreatorInfo>
  >({});
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [activePeriodStatus, setActivePeriodStatus] = useState<
    "open" | "locked"
  >("open");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  async function loadEntryCreators(entryList: PatientFinancialEntry[]) {
    if (!entryList.length) {
      setEntryCreators({});
      return;
    }

    try {
      const response = await fetch("/api/patient-entry-creators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryIds: entryList.map((entry) => entry.id),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load entry creators.");
      }

      setEntryCreators(result.creators || {});
    } catch (error) {
      console.error("Failed to load entry creators:", error);
      setEntryCreators({});
    }
  }

  async function loadData(periodId?: string) {
    setMessage("");

    try {
      await ensureCurrentBillingPeriod();
    } catch {
      // keep going; page can still work even if the helper fails
    }

    const { data: providerData, error: providerError } = await supabase
      .from("providers")
      .select("id, name")
      .order("name");

    if (providerError) {
      setTone("error");
      setMessage(`Error loading providers: ${providerError.message}`);
      return;
    }

    const { data: periodData, error: periodError } = await supabase
      .from("billing_periods")
      .select("id, label, status, month, year")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (periodError) {
      setTone("error");
      setMessage(`Error loading billing periods: ${periodError.message}`);
      return;
    }

    const { data: materialData, error: materialError } = await supabase
      .from("material_cost_items")
      .select(
        "id, name, default_cost, is_active, sort_order, ref_codes, barcode_values"
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (materialError) {
      setTone("error");
      setMessage(`Error loading material presets: ${materialError.message}`);
      return;
    }

    const providerList = (providerData || []) as Provider[];
    const periodList = (periodData || []) as BillingPeriod[];

    setProviders(providerList);
    setBillingPeriods(periodList);
    setMaterialItems((materialData || []) as MaterialCostItem[]);

    const defaultPeriodId = getDefaultBillingPeriodId(periodList);

    const activePeriodId =
      periodId || selectedPeriodId || defaultPeriodId || periodList[0]?.id || "";

    if (activePeriodId && activePeriodId !== selectedPeriodId) {
      setSelectedPeriodId(activePeriodId);
    }

    const activePeriod = periodList.find((p) => p.id === activePeriodId);
    setActivePeriodStatus((activePeriod?.status as "open" | "locked") || "open");

    let query = supabase
      .from("patient_financial_entries")
      .select("*")
      .is("deleted_at", null)
      .order("entry_date", { ascending: false });

    if (activePeriodId) {
      query = query.eq("billing_period_id", activePeriodId);
    }

    const { data: entryData, error: entryError } = await query;

    if (entryError) {
      setTone("error");
      setMessage(`Error loading patient entries: ${entryError.message}`);
      return;
    }

    const entryList = (entryData || []) as PatientFinancialEntry[];

    setEntries(entryList);
    await loadEntryCreators(entryList);

    setForm((prev) => ({
      ...prev,
      provider_id: prev.provider_id || providerList[0]?.id || "",
      billing_period_id: prev.billing_period_id || activePeriodId || "",
    }));
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        materialDropdownRef.current &&
        !materialDropdownRef.current.contains(event.target as Node)
      ) {
        setMaterialDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const relatedProviderOptions = useMemo(() => {
    return providers.filter((p) => p.id !== form.provider_id);
  }, [providers, form.provider_id]);

  const filteredMaterialItems = useMemo(() => {
    const term = materialSearch.trim().toLowerCase();
    const normalizedTerm = normalizeCode(materialSearch);

    if (!term) {
      return materialItems.slice(0, 12);
    }

    const startsWithMatches = materialItems.filter((item) =>
      item.name.toLowerCase().startsWith(term)
    );

    const includesMatches = materialItems.filter((item) => {
      const name = item.name.toLowerCase();
      return name.includes(term) && !name.startsWith(term);
    });

    const codeMatches = materialItems.filter((item) => {
      const normalizedCodes = getItemCodes(item);
      return normalizedCodes.some((code) => code.includes(normalizedTerm));
    });

    return uniqueStrings(
      [...startsWithMatches, ...includesMatches, ...codeMatches].map(
        (item) => item.id
      )
    )
      .map((id) => materialItems.find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 12) as MaterialCostItem[];
  }, [materialItems, materialSearch]);

  const selectedMaterial = useMemo(() => {
    return materialItems.find((item) => item.id === selectedMaterialId) || null;
  }, [materialItems, selectedMaterialId]);

  const yearOptions = useMemo(
    () => getYearsDescending(billingPeriods),
    [billingPeriods]
  );

  const selectedPeriod = useMemo(
    () => billingPeriods.find((p) => p.id === selectedPeriodId),
    [billingPeriods, selectedPeriodId]
  );

  const selectedYear =
    selectedPeriod?.year ?? yearOptions[0] ?? new Date().getFullYear();

  const monthOptionsForSelectedYear = useMemo(
    () => getMonthsAscendingForYear(billingPeriods, selectedYear),
    [billingPeriods, selectedYear]
  );

  const formSelectedPeriod = useMemo(
    () => billingPeriods.find((p) => p.id === form.billing_period_id),
    [billingPeriods, form.billing_period_id]
  );

  const formSelectedYear =
    formSelectedPeriod?.year ?? yearOptions[0] ?? new Date().getFullYear();

  const monthOptionsForFormYear = useMemo(
    () => getMonthsAscendingForYear(billingPeriods, formSelectedYear),
    [billingPeriods, formSelectedYear]
  );

  function resetScanUi() {
    setManualCodeInput("");
    setScanStatusText("");
    setScanDetectedValue("");
    setScanCandidateMatches([]);
  }

  function resetForm(nextPeriodId?: string) {
    setEditingEntryId(null);
    setSelectedMaterialId("");
    setMaterialSearch("");
    setMaterialDropdownOpen(false);
    resetScanUi();
    setForm({
      ...emptyForm,
      provider_id: providers[0]?.id || "",
      billing_period_id:
        nextPeriodId ||
        selectedPeriodId ||
        getDefaultBillingPeriodId(billingPeriods) ||
        "",
    });
  }

  function updatePageBillingPeriod(periodId: string) {
    const period = billingPeriods.find((p) => p.id === periodId);

    setSelectedPeriodId(periodId);
    setEditingEntryId(null);
    setSelectedMaterialId("");
    setMaterialSearch("");
    setMaterialDropdownOpen(false);
    resetScanUi();
    setForm((prev) => ({
      ...prev,
      billing_period_id: periodId,
    }));
    setActivePeriodStatus((period?.status as "open" | "locked") || "open");

    loadData(periodId);
  }

  function handlePageYearChange(year: number) {
    const nextPeriodId = getFallbackPeriodIdForYear(billingPeriods, year);
    if (!nextPeriodId) return;
    updatePageBillingPeriod(nextPeriodId);
  }

  function handlePageMonthChange(month: number) {
    const nextPeriodId = getPeriodIdFromYearMonth(
      billingPeriods,
      selectedYear,
      month
    );
    if (!nextPeriodId) return;
    updatePageBillingPeriod(nextPeriodId);
  }

  function updateFormBillingPeriod(periodId: string) {
    const period = billingPeriods.find((p) => p.id === periodId);

    setForm((prev) => ({ ...prev, billing_period_id: periodId }));
    setActivePeriodStatus((period?.status as "open" | "locked") || "open");
  }

  function handleFormYearChange(year: number) {
    const nextPeriodId = getFallbackPeriodIdForYear(billingPeriods, year);
    if (!nextPeriodId) return;
    updateFormBillingPeriod(nextPeriodId);
  }

  function handleFormMonthChange(month: number) {
    const nextPeriodId = getPeriodIdFromYearMonth(
      billingPeriods,
      formSelectedYear,
      month
    );
    if (!nextPeriodId) return;
    updateFormBillingPeriod(nextPeriodId);
  }

  function applyMaterialPreset(item: MaterialCostItem) {
    setSelectedMaterialId(item.id);
    setMaterialSearch(item.name);
    setMaterialDropdownOpen(false);
    setScanCandidateMatches([]);

    setForm((prev) => ({
      ...prev,
      amount: String(item.default_cost),
      notes: item.name,
    }));
  }

  function handleScanMatch(result: ScanMatchResult) {
    setScanDetectedValue(result.detectedValue);
    setManualCodeInput(result.detectedValue);

    if (result.status === "matched") {
      applyMaterialPreset(result.item);
      setTone("success");
      setMessage(
        `Matched ${result.source === "barcode" ? "barcode" : "photo text"} to: ${
          result.item.name
        }`
      );
      setScanStatusText(`Matched automatically from ${result.source}.`);
      return;
    }

    if (result.status === "multiple") {
      setScanCandidateMatches(result.matches);
      setMaterialSearch(result.detectedValue);
      setMaterialDropdownOpen(false);
      setTone("default");
      setMessage(
        `More than one preset matched ${result.detectedValue}. Please tap the correct material below.`
      );
      setScanStatusText("Multiple possible matches found.");
      return;
    }

    setScanCandidateMatches([]);
    setMaterialSearch(result.detectedValue);
    setMaterialDropdownOpen(true);
    setTone("default");
    setMessage(
      `No exact preset match found for ${result.detectedValue}. You can still search and choose manually.`
    );
    setScanStatusText("No exact match found.");
  }

  async function processManualCodeValue(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      setScanStatusText("");
      setScanDetectedValue("");
      setScanCandidateMatches([]);
      return;
    }

    const result = findMaterialMatches(trimmed, materialItems, "barcode");
    handleScanMatch(result);
  }

  async function handleManualCodeSubmit() {
    await processManualCodeValue(manualCodeInput);
  }

  async function handleMaterialPhoto(file: File | null) {
    if (!file) return;

    setScanLoading(true);
    setScanStatusText("Reading barcode...");
    setScanDetectedValue("");
    setScanCandidateMatches([]);
    setMessage("");

    try {
      const barcodeValue = await scanBarcodeFromImage(file);

      if (barcodeValue) {
        const barcodeResult = findMaterialMatches(
          barcodeValue,
          materialItems,
          "barcode"
        );
        handleScanMatch(barcodeResult);
        setScanLoading(false);
        return;
      }

      setScanStatusText("No barcode found. Reading text from image...");
      const ocrText = await scanTextFromImage(file);
      const candidates = extractCandidatesFromText(ocrText);

      for (const candidate of candidates) {
        const ocrResult = findMaterialMatches(candidate, materialItems, "ocr");

        if (ocrResult.status === "matched") {
          handleScanMatch(ocrResult);
          setScanLoading(false);
          return;
        }

        if (ocrResult.status === "multiple") {
          handleScanMatch(ocrResult);
          setScanLoading(false);
          return;
        }
      }

      const firstCandidate = candidates[0] || "";

      if (firstCandidate) {
        handleScanMatch({
          status: "none",
          detectedValue: firstCandidate,
          source: "ocr",
        });
      } else {
        setTone("error");
        setMessage(
          "Could not read a barcode or REF number from that image. Please try a clearer photo of the sticker."
        );
        setScanStatusText("Could not read a code from the image.");
      }
    } catch (error) {
      console.error(error);
      setTone("error");
      setMessage("Photo scan failed. Please try again.");
      setScanStatusText("Photo scan failed.");
    } finally {
      setScanLoading(false);

      if (cameraInputRef.current) {
        cameraInputRef.current.value = "";
      }

      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (activePeriodStatus === "locked") {
      setTone("error");
      setMessage("This billing period is locked.");
      return;
    }

    if (!form.provider_id) {
      setTone("error");
      setMessage("Please select a provider.");
      return;
    }

    if (!form.billing_period_id) {
      setTone("error");
      setMessage("Please select a billing period.");
      return;
    }

    if (!form.patient_name.trim()) {
      setTone("error");
      setMessage("Please enter a patient name.");
      return;
    }

    if (!form.amount.trim()) {
      setTone("error");
      setMessage("Please enter an amount.");
      return;
    }

    const amount = Number(form.amount);
    if (Number.isNaN(amount)) {
      setTone("error");
      setMessage("Amount must be a valid number.");
      return;
    }

    if (form.category === "paid_to_wrong_provider" && !form.related_provider_id) {
      setTone("error");
      setMessage("Please select the provider who is actually owed the amount.");
      return;
    }

    if (
      form.category === "paid_to_wrong_provider" &&
      form.provider_id === form.related_provider_id
    ) {
      setTone("error");
      setMessage("Paid to provider and owed to provider cannot be the same.");
      return;
    }

    setSaving(true);

    const payload = {
      provider_id: form.provider_id,
      related_provider_id:
        form.category === "paid_to_wrong_provider"
          ? form.related_provider_id || null
          : null,
      billing_period_id: form.billing_period_id,
      patient_name: form.patient_name.trim(),
      entry_date: form.entry_date,
      category: form.category,
      amount,
      notes: form.notes.trim() || null,
    };

    let savedEntryId = editingEntryId;

    if (editingEntryId) {
      const { error } = await supabase
        .from("patient_financial_entries")
        .update(payload)
        .eq("id", editingEntryId);

      if (error) {
        setTone("error");
        setMessage(`Save failed: ${error.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("patient_financial_entries")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        setTone("error");
        setMessage(`Save failed: ${error.message}`);
        setSaving(false);
        return;
      }

      savedEntryId = data.id;
    }

    await writeAuditLog({
      action: editingEntryId ? "patient_entry_updated" : "patient_entry_created",
      entityType: "patient_financial_entry",
      entityId: savedEntryId,
      billingPeriodId: form.billing_period_id,
      providerId: form.provider_id,
      metadata: {
        patient_name: form.patient_name,
        category: form.category,
        amount,
        notes: form.notes,
      },
    });

    setTone("success");
    setMessage(editingEntryId ? "Entry updated." : "Entry saved.");
    setSaving(false);
    resetForm(form.billing_period_id);
    await loadData(form.billing_period_id);
  }

  function beginEdit(entry: PatientFinancialEntry) {
    setEditingEntryId(entry.id);
    setSelectedMaterialId("");
    setMaterialSearch(entry.notes || "");
    setMaterialDropdownOpen(false);
    resetScanUi();
    setForm({
      provider_id: entry.provider_id,
      related_provider_id: entry.related_provider_id || "",
      billing_period_id: entry.billing_period_id || selectedPeriodId,
      patient_name: entry.patient_name,
      entry_date: entry.entry_date,
      category: entry.category,
      amount: String(entry.amount),
      notes: entry.notes || "",
    });

    setTimeout(() => {
      formRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  async function softDeleteEntry(entryId: string) {
    setMessage("");

    if (activePeriodStatus === "locked") {
      setTone("error");
      setMessage("This billing period is locked.");
      return;
    }

    const entry = entries.find((item) => item.id === entryId);
    if (entry?.is_review_locked) {
      setTone("error");
      setMessage("This entry has been reviewed and locked, so it cannot be deleted.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("patient_financial_entries")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id ?? null,
      })
      .eq("id", entryId);

    if (error) {
      setTone("error");
      setMessage(`Delete failed: ${error.message}`);
      return;
    }

    await writeAuditLog({
      action: "patient_entry_deleted",
      entityType: "patient_financial_entry",
      entityId: entryId,
      billingPeriodId: selectedPeriodId,
      providerId: entry?.provider_id || null,
      metadata: {
        patient_name: entry?.patient_name || "",
        category: entry?.category || "",
        amount: entry?.amount || 0,
        notes: entry?.notes || "",
      },
    });

    setTone("success");
    setMessage("Entry deleted.");

    if (editingEntryId === entryId) {
      resetForm(selectedPeriodId);
    }

    await loadData(selectedPeriodId);
  }

  function providerName(providerId: string) {
    return providers.find((p) => p.id === providerId)?.name || "Unknown provider";
  }

  function categoryLabel(category: EntryCategory) {
    switch (category) {
      case "lab_implant_materials":
        return "Lab / Implants / Materials";
      case "fees_paid_to_focus":
        return "Patient Fees Paid to Focus";
      case "fees_paid_in_error":
        return "Patient Fees Paid in Error";
      case "fees_owed":
        return "Patient Fees Owed";
      case "paid_to_wrong_provider":
        return "Paid to Provider X, Owed to Provider Y";
      default:
        return category;
    }
  }

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      entry.patient_name.toLowerCase().includes(search.toLowerCase()) ||
      (entry.notes || "").toLowerCase().includes(search.toLowerCase());

    const matchesCategory = categoryFilter
      ? entry.category === categoryFilter
      : true;

    const matchesProvider = providerFilter
      ? entry.provider_id === providerFilter
      : true;

    return matchesSearch && matchesCategory && matchesProvider;
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <ConfirmDialog
          open={confirmOpen}
          title="Delete entry?"
          description="This will hide the entry from the app but keep an audit trail."
          danger
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

        <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Patient Financial Entries
            </h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Add, edit, and delete patient-level financial adjustments.
            </p>
          </div>

          <Link
            href="/admin/patient-entry-log"
            className="inline-flex w-full items-center justify-center rounded-2xl border bg-white px-4 py-3 text-sm font-medium shadow-sm sm:w-auto"
          >
            Audit Entries
          </Link>
        </div>

        <div className="mt-5 rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="max-w-xl">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Billing period
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="w-full rounded-2xl border bg-white px-3 py-3 text-sm"
                value={selectedYear}
                onChange={(e) => handlePageYearChange(Number(e.target.value))}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>

              <select
                className="w-full rounded-2xl border bg-white px-3 py-3 text-sm"
                value={selectedPeriod?.month || ""}
                onChange={(e) => handlePageMonthChange(Number(e.target.value))}
              >
                <option value="">Select month</option>
                {monthOptionsForSelectedYear.map((month) => (
                  <option key={month} value={month}>
                    {MONTH_OPTIONS.find((item) => item.value === month)?.label ||
                      month}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 text-sm text-slate-600">
              Status:{" "}
              <span
                className={
                  activePeriodStatus === "locked"
                    ? "font-semibold text-amber-700"
                    : "font-semibold text-emerald-700"
                }
              >
                {activePeriodStatus}
              </span>
            </div>
          </div>
        </div>

        {activePeriodStatus === "locked" && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            This billing period is locked. Entries cannot be changed until it is
            reopened.
          </div>
        )}

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <form
          ref={formRef}
          onSubmit={saveEntry}
          className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5 lg:p-6"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {editingEntryId ? "Edit entry" : "Add new entry"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Complete the fields below and save the entry to this billing period.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Provider
              </label>
              <select
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.provider_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    provider_id: e.target.value,
                    related_provider_id:
                      prev.related_provider_id === e.target.value
                        ? ""
                        : prev.related_provider_id,
                  }))
                }
                disabled={activePeriodStatus === "locked"}
              >
                <option value="">Select provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 xl:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Billing period
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                  value={formSelectedYear}
                  onChange={(e) => handleFormYearChange(Number(e.target.value))}
                  disabled={activePeriodStatus === "locked"}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>

                <select
                  className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                  value={formSelectedPeriod?.month || ""}
                  onChange={(e) => handleFormMonthChange(Number(e.target.value))}
                  disabled={activePeriodStatus === "locked"}
                >
                  <option value="">Select month</option>
                  {monthOptionsForFormYear.map((month) => (
                    <option key={month} value={month}>
                      {MONTH_OPTIONS.find((item) => item.value === month)?.label ||
                        month}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Date
              </label>
              <input
                type="date"
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.entry_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, entry_date: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Patient name
              </label>
              <input
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.patient_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, patient_name: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
                placeholder="Enter patient name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    category: e.target.value as EntryCategory,
                    related_provider_id:
                      e.target.value === "paid_to_wrong_provider"
                        ? prev.related_provider_id
                        : "",
                  }))
                }
                disabled={activePeriodStatus === "locked"}
              >
                <option value="lab_implant_materials">
                  Lab / Implants / Materials
                </option>
                <option value="fees_paid_to_focus">
                  Patient Fees Paid to Focus
                </option>
                <option value="paid_to_wrong_provider">
                  Payment to Incorrect Provider
                </option>
              </select>
            </div>

            {form.category === "lab_implant_materials" && (
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Material preset
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                    <input
                      type="text"
                      value={manualCodeInput}
                      onChange={(e) => setManualCodeInput(e.target.value)}
                      placeholder="Scan or type barcode / REF number"
                      className="w-full rounded-2xl border bg-white px-3 py-3 text-sm"
                      disabled={activePeriodStatus === "locked" || scanLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleManualCodeSubmit();
                        }
                      }}
                    />

                    <button
                      type="button"
                      onClick={handleManualCodeSubmit}
                      disabled={activePeriodStatus === "locked" || scanLoading}
                      className="inline-flex items-center justify-center rounded-2xl border bg-white px-4 py-3 text-sm font-medium disabled:opacity-50"
                    >
                      Match code
                    </button>

                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={activePeriodStatus === "locked" || scanLoading}
                      className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {scanLoading ? "Scanning..." : "Camera"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={activePeriodStatus === "locked" || scanLoading}
                      className="inline-flex items-center justify-center rounded-2xl border bg-white px-4 py-3 text-sm font-medium disabled:opacity-50"
                    >
                      Upload photo
                    </button>

                    <div className="flex min-h-[48px] items-center text-sm text-slate-600">
                      {scanStatusText || "Photograph the barcode or REF sticker for the best result."}
                    </div>
                  </div>

                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) =>
                      handleMaterialPhoto(e.target.files?.[0] || null)
                    }
                  />

                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) =>
                      handleMaterialPhoto(e.target.files?.[0] || null)
                    }
                  />

                  {scanDetectedValue && (
                    <div className="mt-3 rounded-2xl bg-white px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                      Detected code:{" "}
                      <span className="font-semibold">{scanDetectedValue}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <div ref={materialDropdownRef} className="relative">
                    <input
                      type="text"
                      value={materialSearch}
                      onChange={(e) => {
                        setMaterialSearch(e.target.value);
                        setMaterialDropdownOpen(true);
                        setSelectedMaterialId("");
                      }}
                      onFocus={() => setMaterialDropdownOpen(true)}
                      placeholder="Search preset name, barcode, or REF number"
                      className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                      disabled={activePeriodStatus === "locked"}
                    />

                    {materialDropdownOpen && activePeriodStatus !== "locked" && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border bg-white p-2 shadow-lg">
                        {filteredMaterialItems.length > 0 ? (
                          <div className="space-y-1">
                            {filteredMaterialItems.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => applyMaterialPreset(item)}
                                className="flex w-full items-start justify-between rounded-xl px-3 py-3 text-left hover:bg-slate-50"
                              >
                                <div className="min-w-0 pr-3">
                                  <div className="font-medium text-slate-900">
                                    {item.name}
                                  </div>

                                  <div className="mt-1 text-xs text-slate-500">
                                    REF: {(item.ref_codes || []).join(", ") || "—"}
                                  </div>

                                  <div className="mt-1 text-xs text-slate-500">
                                    Barcode: {(item.barcode_values || []).join(", ") || "—"}
                                  </div>
                                </div>

                                <div className="shrink-0 text-sm font-semibold text-slate-700">
                                  ${formatCurrency(item.default_cost)}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-3 text-sm text-slate-500">
                            No matching presets found.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>
                      Use camera on mobile, or scan/type a barcode on desktop.
                    </span>
                    {selectedMaterial && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
                        Selected: {selectedMaterial.name}
                      </span>
                    )}
                  </div>
                </div>

                {scanCandidateMatches.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3">
                    <div className="mb-2 text-sm font-medium text-amber-900">
                      Multiple matches found. Tap the correct material:
                    </div>

                    <div className="space-y-2">
                      {scanCandidateMatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyMaterialPreset(item)}
                          className="flex w-full items-start justify-between rounded-xl bg-white px-3 py-3 text-left shadow-sm"
                        >
                          <div>
                            <div className="font-medium text-slate-900">
                              {item.name}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              REF: {(item.ref_codes || []).join(", ") || "—"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Barcode: {(item.barcode_values || []).join(", ") || "—"}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-slate-700">
                            ${formatCurrency(item.default_cost)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.amount}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, amount: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
                placeholder="0.00"
              />
            </div>

            {form.category === "paid_to_wrong_provider" && (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Provider actually owed
                </label>
                <select
                  className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                  value={form.related_provider_id}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      related_provider_id: e.target.value,
                    }))
                  }
                  disabled={activePeriodStatus === "locked"}
                >
                  <option value="">Select provider</option>
                  {relatedProviderOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="xl:col-span-3">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Notes
              </label>
              <input
                className="w-full rounded-2xl border px-3 py-3 text-sm disabled:bg-slate-100"
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
                placeholder="Optional notes"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              disabled={saving || activePeriodStatus === "locked"}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
            >
              {saving
                ? "Saving..."
                : editingEntryId
                ? "Update entry"
                : "Save entry"}
            </button>

            {editingEntryId && (
              <button
                type="button"
                onClick={() => resetForm(selectedPeriodId)}
                className="inline-flex w-full items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium sm:w-auto"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
            <p className="mt-1 text-sm text-slate-600">
              Narrow the entries below by patient, category, or provider.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="text"
              placeholder="Search patient or notes..."
              className="rounded-2xl border px-3 py-3 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="rounded-2xl border px-3 py-3 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              <option value="lab_implant_materials">
                Lab / Implants / Materials
              </option>
              <option value="fees_paid_to_focus">
                Patient Fees Paid to Focus
              </option>
              <option value="fees_paid_in_error">
                Patient Fees Paid in Error
              </option>
              <option value="fees_owed">Patient Fees Owed</option>
              <option value="paid_to_wrong_provider">
                Paid to Wrong Provider
              </option>
            </select>

            <select
              className="rounded-2xl border px-3 py-3 text-sm"
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <Link
            href="/patient-entries/review"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm sm:w-auto"
          >
            Review Entries
          </Link>
        </div>

        <div className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5 lg:p-6">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Saved entries</h2>
            <p className="text-sm text-slate-500">
              {filteredEntries.length} matching entr
              {filteredEntries.length === 1 ? "y" : "ies"}
            </p>
          </div>

          <div className="space-y-3">
            {filteredEntries.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">
                No matching entries found for this billing period.
              </div>
            )}

            {filteredEntries.map((entry) => {
              const creator = entryCreators[entry.id];
              const badgeColorClass = getBadgeColorClass(
                creator?.userId || creator?.displayName || entry.id
              );
              const isReviewed = Boolean(entry.is_verified);
              const isReviewLocked = Boolean(entry.is_review_locked);

              return (
                <div
                  key={entry.id}
                  className="rounded-2xl border p-4 text-sm sm:p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">
                        {entry.patient_name}
                      </div>

                      <div className="mt-1 text-slate-600">
                        {providerName(entry.provider_id)}
                      </div>

                      <div className="mt-2 text-slate-500">
                        <div>{entry.entry_date}</div>
                        <div className="mt-1">
                          {categoryLabel(entry.category)}
                        </div>
                        <div className="mt-1 font-medium text-slate-700">
                          ${formatCurrency(entry.amount)}
                        </div>
                      </div>

                      {entry.related_provider_id && (
                        <div className="mt-2 text-slate-600">
                          Owed to: {providerName(entry.related_provider_id)}
                        </div>
                      )}

                      {entry.notes && (
                        <div className="mt-2 break-words text-slate-600">
                          {entry.notes}
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {isReviewed ? (
                          <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                            Reviewed by {entry.verified_by_initials || "--"}
                          </div>
                        ) : (
                          <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                            Not yet reviewed
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start lg:flex-col lg:items-end">
                      <div className="group relative self-start lg:self-end">
                        <div
                          aria-label={
                            creator
                              ? `Created by ${creator.displayName}`
                              : "Creator not available"
                          }
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold ring-1 ${badgeColorClass}`}
                        >
                          {creator?.initials || "?"}
                        </div>

                        <div className="pointer-events-none absolute left-0 top-12 z-10 hidden whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block sm:left-auto sm:right-0">
                          {creator
                            ? `Created by ${creator.displayName}`
                            : "Creator not available"}
                        </div>
                      </div>

                      {!isReviewLocked && (
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:flex-col">
                          <button
                            type="button"
                            onClick={() => beginEdit(entry)}
                            disabled={activePeriodStatus === "locked"}
                            className="rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmAction(() => () => softDeleteEntry(entry.id));
                              setConfirmOpen(true);
                            }}
                            disabled={activePeriodStatus === "locked"}
                            className="rounded-xl border px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}