"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_initials: string | null;
  is_review_locked: boolean;
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
  if (currentMonthPeriod) return currentMonthPeriod.id;

  const firstMonthPeriod = periods
    .filter((p) => p.year === year)
    .sort((a, b) => a.month - b.month)[0];

  return firstMonthPeriod?.id || "";
}

function getDefaultBillingPeriodId(periods: BillingPeriod[]) {
  if (!periods.length) return "";

  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();

  const currentPeriod = periods.find(
    (p) => p.year === currentYear && p.month === currentMonth
  );
  if (currentPeriod) return currentPeriod.id;

  const years = Array.from(new Set(periods.map((p) => p.year))).sort(
    (a, b) => b - a
  );
  const latestYear = years[0];

  const currentMonthInLatestYear = periods.find(
    (p) => p.year === latestYear && p.month === currentMonth
  );
  if (currentMonthInLatestYear) return currentMonthInLatestYear.id;

  const firstMonthInLatestYear = periods
    .filter((p) => p.year === latestYear)
    .sort((a, b) => a.month - b.month)[0];

  return firstMonthInLatestYear?.id || periods[0]?.id || "";
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

function getInitials(nameOrEmail: string) {
  const cleaned = nameOrEmail.trim();
  if (!cleaned) return "??";

  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function ReviewPatientEntriesPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [materialItems, setMaterialItems] = useState<MaterialCostItem[]>([]);
  const [entries, setEntries] = useState<PatientFinancialEntry[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");

  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [reviewerInitials, setReviewerInitials] = useState("??");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [savingForm, setSavingForm] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  async function loadData(periodId?: string) {
    setLoading(true);
    setMessage("");
    setAccessDenied(false);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setTone("error");
      setMessage("You must be signed in.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      setTone("error");
      setMessage(`Could not load user role: ${profileError.message}`);
      setLoading(false);
      return;
    }

    const role = profile?.role ?? "";
    if (
      role !== "practice_manager" &&
      role !== "billing_staff" &&
      role !== "admin"
    ) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    setReviewerInitials(
      getInitials(profile?.full_name || user.email || "Manager")
    );

    const [
      { data: providerData, error: providerError },
      { data: periodData, error: periodError },
      { data: materialData, error: materialError },
    ] = await Promise.all([
      supabase.from("providers").select("id, name").order("name"),
      supabase
        .from("billing_periods")
        .select("id, label, status, month, year")
        .order("year", { ascending: false })
        .order("month", { ascending: false }),
      supabase
        .from("material_cost_items")
        .select("id, name, default_cost, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (providerError) {
      setTone("error");
      setMessage(`Error loading providers: ${providerError.message}`);
      setLoading(false);
      return;
    }

    if (periodError) {
      setTone("error");
      setMessage(`Error loading billing periods: ${periodError.message}`);
      setLoading(false);
      return;
    }

    if (materialError) {
      setTone("error");
      setMessage(`Error loading material presets: ${materialError.message}`);
      setLoading(false);
      return;
    }

    const providerList = (providerData || []) as Provider[];
    const periodList = (periodData || []) as BillingPeriod[];

    setProviders(providerList);
    setBillingPeriods(periodList);
    setMaterialItems((materialData || []) as MaterialCostItem[]);

    const activePeriodId =
      periodId || selectedPeriodId || getDefaultBillingPeriodId(periodList);

    setSelectedPeriodId(activePeriodId);

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
      setMessage(`Error loading entries: ${entryError.message}`);
      setLoading(false);
      return;
    }

    const entryList = (entryData || []) as PatientFinancialEntry[];
    setEntries(entryList);

    setForm((prev) => ({
      ...prev,
      provider_id: prev.provider_id || providerList[0]?.id || "",
      billing_period_id: prev.billing_period_id || activePeriodId || "",
    }));

    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const relatedProviderOptions = useMemo(() => {
    return providers.filter((p) => p.id !== form.provider_id);
  }, [providers, form.provider_id]);

  function handlePageYearChange(year: number) {
    const nextPeriodId = getFallbackPeriodIdForYear(billingPeriods, year);
    if (!nextPeriodId) return;
    setSelectedPeriodId(nextPeriodId);
    setEditingEntryId(null);
    loadData(nextPeriodId);
  }

  function handlePageMonthChange(month: number) {
    const nextPeriodId = getPeriodIdFromYearMonth(
      billingPeriods,
      selectedYear,
      month
    );
    if (!nextPeriodId) return;
    setSelectedPeriodId(nextPeriodId);
    setEditingEntryId(null);
    loadData(nextPeriodId);
  }

  function handleFormYearChange(year: number) {
    const nextPeriodId = getFallbackPeriodIdForYear(billingPeriods, year);
    if (!nextPeriodId) return;
    setForm((prev) => ({ ...prev, billing_period_id: nextPeriodId }));
  }

  function handleFormMonthChange(month: number) {
    const nextPeriodId = getPeriodIdFromYearMonth(
      billingPeriods,
      formSelectedYear,
      month
    );
    if (!nextPeriodId) return;
    setForm((prev) => ({ ...prev, billing_period_id: nextPeriodId }));
  }

  function providerName(providerId: string) {
    return providers.find((p) => p.id === providerId)?.name || "Unknown provider";
  }

  function resetForm(nextPeriodId?: string) {
    setEditingEntryId(null);
    setSelectedMaterialId("");
    setForm({
      ...emptyForm,
      provider_id: providers[0]?.id || "",
      billing_period_id: nextPeriodId || selectedPeriodId || "",
    });
  }

  function beginEdit(entry: PatientFinancialEntry) {
    setEditingEntryId(entry.id);
    setSelectedMaterialId("");
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

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveEntryFromReview(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!editingEntryId) {
      setTone("error");
      setMessage("No entry selected for editing.");
      return;
    }

    const originalEntry = entries.find((entry) => entry.id === editingEntryId);
    if (!originalEntry) {
      setTone("error");
      setMessage("The selected entry could not be found.");
      return;
    }

    if (originalEntry.is_review_locked) {
      setTone("error");
      setMessage("This entry has already been reviewed and locked.");
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

    setSavingForm(true);

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

    const { error } = await supabase
      .from("patient_financial_entries")
      .update(payload)
      .eq("id", editingEntryId);

    if (error) {
      setTone("error");
      setMessage(`Save failed: ${error.message}`);
      setSavingForm(false);
      return;
    }

    await writeAuditLog({
      action: "patient_entry_updated_from_review",
      entityType: "patient_financial_entry",
      entityId: editingEntryId,
      billingPeriodId: form.billing_period_id,
      providerId: form.provider_id,
      metadata: {
        patient_name: form.patient_name,
        category: form.category,
        amount,
        notes: form.notes,
        review_source: "review_page",
      },
    });

    setTone("success");
    setMessage("Entry updated from review page.");
    setSavingForm(false);
    resetForm(form.billing_period_id);
    await loadData(form.billing_period_id);
  }

  async function deleteEntryFromReview(entry: PatientFinancialEntry) {
    setMessage("");

    if (entry.is_review_locked) {
      setTone("error");
      setMessage("This entry has already been reviewed and locked.");
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
      .eq("id", entry.id);

    if (error) {
      setTone("error");
      setMessage(`Delete failed: ${error.message}`);
      return;
    }

    await writeAuditLog({
      action: "patient_entry_deleted_from_review",
      entityType: "patient_financial_entry",
      entityId: entry.id,
      billingPeriodId: entry.billing_period_id,
      providerId: entry.provider_id,
      metadata: {
        patient_name: entry.patient_name,
        category: entry.category,
        amount: entry.amount,
        notes: entry.notes || "",
        review_source: "review_page",
      },
    });

    if (editingEntryId === entry.id) {
      resetForm(selectedPeriodId);
    }

    setTone("success");
    setMessage("Entry deleted from review page.");
    await loadData(selectedPeriodId);
  }

  async function verifyAndLock(entry: PatientFinancialEntry) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setTone("error");
      setMessage("You must be signed in.");
      return;
    }

    if (entry.is_review_locked) {
      setTone("error");
      setMessage("This entry has already been verified and locked.");
      return;
    }

    setSavingId(entry.id);

    const updatePayload = {
      is_verified: true,
      verified_at: new Date().toISOString(),
      verified_by: user.id,
      verified_by_initials: reviewerInitials,
      is_review_locked: true,
    };

    const { error } = await supabase
      .from("patient_financial_entries")
      .update(updatePayload)
      .eq("id", entry.id);

    if (error) {
      setTone("error");
      setMessage(`Failed to update review status: ${error.message}`);
      setSavingId(null);
      return;
    }

    await writeAuditLog({
      action: "patient_entry_reviewed",
      entityType: "patient_financial_entry",
      entityId: entry.id,
      billingPeriodId: entry.billing_period_id,
      providerId: entry.provider_id,
      metadata: {
        patient_name: entry.patient_name,
        category: entry.category,
        amount: entry.amount,
        notes: entry.notes || "",
        reviewer_initials: reviewerInitials,
        review_status: "verified_locked",
      },
    });

    setEntries((prev) =>
      prev.map((item) =>
        item.id === entry.id ? { ...item, ...updatePayload } : item
      )
    );

    setTone("success");
    setMessage("Entry verified and locked.");
    setSavingId(null);
  }

  async function unlockEntry(entry: PatientFinancialEntry) {
    setSavingId(entry.id);

    const updatePayload = {
      is_verified: false,
      verified_at: null,
      verified_by: null,
      verified_by_initials: null,
      is_review_locked: false,
    };

    const { error } = await supabase
      .from("patient_financial_entries")
      .update(updatePayload)
      .eq("id", entry.id);

    if (error) {
      setTone("error");
      setMessage(`Failed to unlock entry: ${error.message}`);
      setSavingId(null);
      return;
    }

    await writeAuditLog({
      action: "patient_entry_review_removed",
      entityType: "patient_financial_entry",
      entityId: entry.id,
      billingPeriodId: entry.billing_period_id,
      providerId: entry.provider_id,
      metadata: {
        patient_name: entry.patient_name,
        category: entry.category,
        amount: entry.amount,
        notes: entry.notes || "",
        reviewer_initials: reviewerInitials,
        review_status: "review_removed",
      },
    });

    setEntries((prev) =>
      prev.map((item) =>
        item.id === entry.id ? { ...item, ...updatePayload } : item
      )
    );

    setTone("success");
    setMessage("Entry unlocked.");
    setSavingId(null);
  }

  if (accessDenied) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Access denied</h1>
          <p className="mt-2 text-sm text-slate-600">
            This page is only available to practice managers, billing staff, and admin users.
          </p>
          <Link
            href="/patient-entries"
            className="mt-4 inline-flex rounded-2xl border px-4 py-3 text-sm font-medium"
          >
            Back to Patient Entries
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Review and Confirm Entries
            </h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Review, edit, delete, verify, and unlock patient entries.
            </p>
          </div>

          <Link
            href="/patient-entries"
            className="inline-flex w-full items-center justify-center rounded-2xl border bg-white px-4 py-3 text-sm font-medium shadow-sm sm:w-auto"
          >
            Back to Patient Entries
          </Link>
        </div>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <div className="mt-5 grid gap-6 xl:grid-cols-[1.1fr_1.3fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
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
              </div>
            </div>

            <form
              onSubmit={saveEntryFromReview}
              className="rounded-3xl border bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-slate-900">
                  {editingEntryId ? "Edit selected entry" : "Select an entry to edit"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Managers, billing staff, and admin users can correct unlocked entries here.
                </p>
              </div>

              {!editingEntryId ? (
                <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Choose an entry from the list on the right and press Edit.
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Provider
                      </label>
                      <select
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
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
                      >
                        <option value="">Select provider</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Date
                      </label>
                      <input
                        type="date"
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
                        value={form.entry_date}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            entry_date: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Billing period
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select
                          className="w-full rounded-2xl border px-3 py-3 text-sm"
                          value={formSelectedYear}
                          onChange={(e) =>
                            handleFormYearChange(Number(e.target.value))
                          }
                        >
                          {yearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>

                        <select
                          className="w-full rounded-2xl border px-3 py-3 text-sm"
                          value={formSelectedPeriod?.month || ""}
                          onChange={(e) =>
                            handleFormMonthChange(Number(e.target.value))
                          }
                        >
                          <option value="">Select month</option>
                          {monthOptionsForFormYear.map((month) => (
                            <option key={month} value={month}>
                              {MONTH_OPTIONS.find((item) => item.value === month)
                                ?.label || month}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Patient name
                      </label>
                      <input
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
                        value={form.patient_name}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            patient_name: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Category
                      </label>
                      <select
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
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
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">
                          Material preset
                        </label>
                        <select
                          className="w-full rounded-2xl border px-3 py-3 text-sm"
                          value={selectedMaterialId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSelectedMaterialId(value);

                            const item = materialItems.find((m) => m.id === value);
                            if (!item) return;

                            setForm((prev) => ({
                              ...prev,
                              amount: String(item.default_cost),
                              notes: item.name,
                            }));
                          }}
                        >
                          <option value="">Select preset</option>
                          {materialItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} — $
                              {Number(item.default_cost).toLocaleString("en-AU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
                        value={form.amount}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            amount: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {form.category === "paid_to_wrong_provider" && (
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">
                          Provider actually owed
                        </label>
                        <select
                          className="w-full rounded-2xl border px-3 py-3 text-sm"
                          value={form.related_provider_id}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              related_provider_id: e.target.value,
                            }))
                          }
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

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Notes
                      </label>
                      <input
                        className="w-full rounded-2xl border px-3 py-3 text-sm"
                        value={form.notes}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={savingForm}
                      className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
                    >
                      {savingForm ? "Saving..." : "Save changes"}
                    </button>

                    <button
                      type="button"
                      onClick={() => resetForm(selectedPeriodId)}
                      className="inline-flex w-full items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium sm:w-auto"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>

          <div className="rounded-3xl border bg-white p-4 shadow-sm sm:p-5 lg:p-6">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Entries for review</h2>
              <p className="text-sm text-slate-500">
                Reviewer initials: {reviewerInitials}
              </p>
            </div>

            {loading ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Loading entries...
              </div>
            ) : entries.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No entries found for this billing period.
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border p-4 text-sm sm:p-5"
                  >
                    <div className="flex flex-col gap-4">
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
                            <div className="mt-1">{categoryLabel(entry.category)}</div>
                            <div className="mt-1 font-medium text-slate-700">
                              $
                              {Number(entry.amount).toLocaleString("en-AU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
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

                          <div className="mt-3">
                            {entry.is_verified ? (
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

                        <div className="flex min-w-[220px] flex-col gap-3">
                          {!entry.is_review_locked ? (
                            <button
                              type="button"
                              onClick={() => verifyAndLock(entry)}
                              disabled={savingId === entry.id}
                              className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                            >
                              {savingId === entry.id ? "Saving..." : "Verify and lock"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => unlockEntry(entry)}
                              disabled={savingId === entry.id}
                              className="inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium text-amber-700 disabled:opacity-50"
                            >
                              {savingId === entry.id ? "Saving..." : "Unlock entry"}
                            </button>
                          )}

                          <div className="rounded-2xl border bg-white px-4 py-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Reviewer initials
                            </div>
                            <div className="mt-1 text-lg font-semibold text-slate-900">
                              {entry.verified_by_initials || "--"}
                            </div>
                          </div>

                          <div className="text-xs text-slate-500">
                            {entry.verified_at
                              ? `Verified at ${new Date(entry.verified_at).toLocaleString()}`
                              : "Not yet verified"}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => beginEdit(entry)}
                          disabled={entry.is_review_locked}
                          className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          Edit entry
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setConfirmAction(() => () => deleteEntryFromReview(entry));
                            setConfirmOpen(true);
                          }}
                          disabled={entry.is_review_locked}
                          className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
                        >
                          Delete entry
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
      </div>
    </main>
  );
}