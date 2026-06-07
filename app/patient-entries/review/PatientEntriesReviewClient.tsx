"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PageLayout from "@/components/ui/PageLayout";
import Toast from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type EntryCategory =
  | "lab_implant_materials"
  | "fees_paid_to_focus"
  | "fees_paid_in_error"
  | "fees_owed"
  | "paid_to_wrong_provider";

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

type ReviewerInfo = {
  userId: string;
  displayName: string;
  initials: string;
};

type CurrentUser = {
  id: string;
  displayName: string;
  initials: string;
  role: string;
};

type Props = {
  currentUser: CurrentUser;
  providers: Provider[];
  billingPeriods: BillingPeriod[];
  initialEntries: PatientFinancialEntry[];
  initialReviewerInfo: Record<string, ReviewerInfo>;
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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

function getYearsDescending(periods: BillingPeriod[]) {
  return Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);
}

function getMonthsAscendingForYear(periods: BillingPeriod[], year: number) {
  return Array.from(
    new Set(periods.filter((p) => p.year === year).map((p) => p.month)),
  ).sort((a, b) => a - b);
}

function getDefaultBillingPeriodId(periods: BillingPeriod[]) {
  if (!periods.length) return "";

  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const years = getYearsDescending(periods);
  const latestYear = years[0];

  const currentMonthInLatestYear = periods.find(
    (period) => period.year === latestYear && period.month === currentMonth,
  );

  if (currentMonthInLatestYear) return currentMonthInLatestYear.id;

  return (
    periods
      .filter((period) => period.year === latestYear)
      .sort((a, b) => a.month - b.month)[0]?.id ||
    periods[0]?.id ||
    ""
  );
}

function getFallbackPeriodIdForYear(periods: BillingPeriod[], year: number) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;

  const currentMonthPeriod = periods.find(
    (period) => period.year === year && period.month === currentMonth,
  );

  if (currentMonthPeriod) return currentMonthPeriod.id;

  return (
    periods
      .filter((period) => period.year === year)
      .sort((a, b) => a.month - b.month)[0]?.id || ""
  );
}

function getPeriodIdFromYearMonth(
  periods: BillingPeriod[],
  year: number,
  month: number,
) {
  return (
    periods.find((period) => period.year === year && period.month === month)
      ?.id || ""
  );
}

export default function PatientEntriesReviewClient({
  currentUser,
  providers,
  billingPeriods,
  initialEntries,
  initialReviewerInfo,
}: Props) {
  const [entries, setEntries] =
    useState<PatientFinancialEntry[]>(initialEntries);
  const [reviewerInfo, setReviewerInfo] =
    useState<Record<string, ReviewerInfo>>(initialReviewerInfo);

  const [selectedPeriodId, setSelectedPeriodId] = useState(
    getDefaultBillingPeriodId(billingPeriods),
  );

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<
    "all" | "unreviewed" | "reviewed_locked"
  >("unreviewed");

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    provider_id: "",
    related_provider_id: "",
    patient_name: "",
    entry_date: "",
    category: "lab_implant_materials" as EntryCategory,
    amount: "",
    notes: "",
  });

  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEntryId, setConfirmEntryId] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<"review" | "unlock">("review");

  const selectedPeriod = useMemo(
    () => billingPeriods.find((period) => period.id === selectedPeriodId),
    [billingPeriods, selectedPeriodId],
  );

  const yearOptions = useMemo(
    () => getYearsDescending(billingPeriods),
    [billingPeriods],
  );

  const selectedYear =
    selectedPeriod?.year ?? yearOptions[0] ?? new Date().getFullYear();

  const monthOptionsForSelectedYear = useMemo(
    () => getMonthsAscendingForYear(billingPeriods, selectedYear),
    [billingPeriods, selectedYear],
  );

  const activePeriodStatus = selectedPeriod?.status || "open";

  const canUnlock = ["practice_manager", "admin", "super_admin"].includes(
    currentUser.role,
  );

  function providerName(providerId: string | null) {
    if (!providerId) return "—";
    return (
      providers.find((provider) => provider.id === providerId)?.name ||
      "Unknown provider"
    );
  }

  function handleYearChange(year: number) {
    const nextPeriodId = getFallbackPeriodIdForYear(billingPeriods, year);
    if (nextPeriodId) setSelectedPeriodId(nextPeriodId);
  }

  function handleMonthChange(month: number) {
    const nextPeriodId = getPeriodIdFromYearMonth(
      billingPeriods,
      selectedYear,
      month,
    );
    if (nextPeriodId) setSelectedPeriodId(nextPeriodId);
  }

  function beginEdit(entry: PatientFinancialEntry) {
    setEditingEntryId(entry.id);
    setEditForm({
      provider_id: entry.provider_id,
      related_provider_id: entry.related_provider_id || "",
      patient_name: entry.patient_name,
      entry_date: entry.entry_date,
      category: entry.category,
      amount: String(entry.amount),
      notes: entry.notes || "",
    });
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setEditForm({
      provider_id: "",
      related_provider_id: "",
      patient_name: "",
      entry_date: "",
      category: "lab_implant_materials",
      amount: "",
      notes: "",
    });
  }

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesPeriod = selectedPeriodId
        ? entry.billing_period_id === selectedPeriodId
        : true;

      const searchTerm = search.trim().toLowerCase();

      const matchesSearch = searchTerm
        ? entry.patient_name.toLowerCase().includes(searchTerm) ||
          (entry.notes || "").toLowerCase().includes(searchTerm)
        : true;

      const matchesCategory = categoryFilter
        ? entry.category === categoryFilter
        : true;

      const matchesProvider = providerFilter
        ? entry.provider_id === providerFilter
        : true;

      const isReviewedLocked =
        Boolean(entry.is_verified) && Boolean(entry.is_review_locked);

      const matchesReviewFilter =
        reviewFilter === "all"
          ? true
          : reviewFilter === "reviewed_locked"
          ? isReviewedLocked
          : !isReviewedLocked;

      return (
        matchesPeriod &&
        matchesSearch &&
        matchesCategory &&
        matchesProvider &&
        matchesReviewFilter
      );
    });
  }, [
    entries,
    selectedPeriodId,
    search,
    categoryFilter,
    providerFilter,
    reviewFilter,
  ]);

  const reviewedCount = entries.filter(
    (entry) =>
      entry.billing_period_id === selectedPeriodId &&
      entry.is_verified &&
      entry.is_review_locked,
  ).length;

  const totalForPeriod = entries.filter(
    (entry) => entry.billing_period_id === selectedPeriodId,
  ).length;

  async function submitReviewAction(entryId: string, mode: "review" | "unlock") {
    setSavingEntryId(entryId);
    setMessage("");

    try {
      const response = await fetch("/api/patient-entries/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId,
          action: mode,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Review action failed.");
      }

      const updatedEntry = result.entry as PatientFinancialEntry;

      setEntries((prev) =>
        prev.map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry)),
      );

      if (mode === "review") {
        setReviewerInfo((prev) => ({
          ...prev,
          [currentUser.id]: {
            userId: currentUser.id,
            displayName: currentUser.displayName,
            initials: currentUser.initials,
          },
        }));
      }

      setTone("success");
      setMessage(
        mode === "review"
          ? "Entry reviewed and locked."
          : "Entry unlocked. Review has been removed.",
      );
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error ? error.message : "Review action failed.",
      );
    } finally {
      setSavingEntryId(null);
    }
  }

  async function saveEditedEntry(entryId: string) {
    setSavingEntryId(entryId);
    setMessage("");

    try {
      const response = await fetch("/api/patient-entries/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId,
          action: "update",
          ...editForm,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Update failed.");
      }

      const updatedEntry = result.entry as PatientFinancialEntry;

      setEntries((prev) =>
        prev.map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry)),
      );

      setTone("success");
      setMessage("Entry updated. You can now review and lock it.");
      cancelEdit();
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setSavingEntryId(null);
    }
  }

  return (
    <PageLayout
      eyebrow="Admin"
      title="Review Patient Entries"
      description="Review, edit, verify, lock, and unlock patient-level financial entries before billing completion."
    >
      <ConfirmDialog
        open={confirmOpen}
        title={
          confirmMode === "review"
            ? "Review and lock entry?"
            : "Unlock this entry?"
        }
        description={
          confirmMode === "review"
            ? "This will mark the entry as reviewed and lock it from editing or deletion."
            : "This will remove the review and unlock the entry for editing."
        }
        danger={confirmMode === "unlock"}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmEntryId(null);
        }}
        onConfirm={() => {
          if (confirmEntryId) {
            submitReviewAction(confirmEntryId, confirmMode);
          }
          setConfirmOpen(false);
          setConfirmEntryId(null);
        }}
      />

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                Review and lock
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Verify entries before they are used for provider billing.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                Edit entries if needed, then review and lock them. Managers and
                admins can unlock entries if a correction is required.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/patient-entries"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 sm:w-auto"
              >
                Patient Entries
              </Link>

              <Link
                href="/admin/patient-entry-log"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 sm:w-auto"
              >
                Audit Log
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Billing period
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
              value={selectedYear}
              onChange={(event) => handleYearChange(Number(event.target.value))}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
              value={selectedPeriod?.month || ""}
              onChange={(event) => handleMonthChange(Number(event.target.value))}
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
            Period status:{" "}
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

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="text-sm font-medium text-slate-500">
            Review progress
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">
            {reviewedCount}/{totalForPeriod}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            reviewed and locked
          </div>
        </div>
      </div>

      {message && (
        <div className="mt-4">
          <Toast message={message} tone={tone} />
        </div>
      )}

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="text"
            placeholder="Search patient or notes..."
            className="rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="rounded-2xl border border-slate-300 px-3 py-3 text-sm"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
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
            className="rounded-2xl border border-slate-300 px-3 py-3 text-sm"
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
          >
            <option value="">All providers</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>

          <select
            className="rounded-2xl border border-slate-300 px-3 py-3 text-sm"
            value={reviewFilter}
            onChange={(event) =>
              setReviewFilter(
                event.target.value as "all" | "unreviewed" | "reviewed_locked",
              )
            }
          >
            <option value="unreviewed">Needs review</option>
            <option value="reviewed_locked">Reviewed and locked</option>
            <option value="all">All entries</option>
          </select>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-900">
            Entries for review
          </h2>
          <p className="text-sm text-slate-500">
            {filteredEntries.length} matching entr
            {filteredEntries.length === 1 ? "y" : "ies"}
          </p>
        </div>

        <div className="space-y-3">
          {filteredEntries.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">
              No matching entries found.
            </div>
          )}

          {filteredEntries.map((entry) => {
            const isReviewedLocked =
              Boolean(entry.is_verified) && Boolean(entry.is_review_locked);

            const isEditing = editingEntryId === entry.id;

            const reviewer = entry.verified_by
              ? reviewerInfo[entry.verified_by]
              : null;

            const badgeColorClass = getBadgeColorClass(
              reviewer?.userId || reviewer?.displayName || entry.id,
            );

            return (
              <div
                key={entry.id}
                className={
                  isReviewedLocked
                    ? "rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm sm:p-5"
                    : "rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5"
                }
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">
                            Provider
                          </label>
                          <select
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.provider_id}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                provider_id: event.target.value,
                                related_provider_id:
                                  prev.related_provider_id === event.target.value
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
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.entry_date}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                entry_date: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">
                            Patient name
                          </label>
                          <input
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.patient_name}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                patient_name: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">
                            Category
                          </label>
                          <select
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.category}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                category: event.target.value as EntryCategory,
                                related_provider_id:
                                  event.target.value === "paid_to_wrong_provider"
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
                            <option value="fees_paid_in_error">
                              Patient Fees Paid in Error
                            </option>
                            <option value="fees_owed">Patient Fees Owed</option>
                            <option value="paid_to_wrong_provider">
                              Paid to Wrong Provider
                            </option>
                          </select>
                        </div>

                        {editForm.category === "paid_to_wrong_provider" && (
                          <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                              Provider actually owed
                            </label>
                            <select
                              className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                              value={editForm.related_provider_id}
                              onChange={(event) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  related_provider_id: event.target.value,
                                }))
                              }
                            >
                              <option value="">Select provider</option>
                              {providers
                                .filter(
                                  (provider) =>
                                    provider.id !== editForm.provider_id,
                                )
                                .map((provider) => (
                                  <option key={provider.id} value={provider.id}>
                                    {provider.name}
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
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.amount}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                amount: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className="xl:col-span-3">
                          <label className="mb-2 block text-sm font-medium text-slate-700">
                            Notes
                          </label>
                          <input
                            className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm"
                            value={editForm.notes}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                notes: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-slate-900">
                            {entry.patient_name}
                          </div>

                          {isReviewedLocked ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                              Reviewed and locked
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                              Needs review
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-slate-600">
                          Provider: {providerName(entry.provider_id)}
                        </div>

                        {entry.related_provider_id && (
                          <div className="mt-1 text-slate-600">
                            Owed to: {providerName(entry.related_provider_id)}
                          </div>
                        )}

                        <div className="mt-2 text-slate-500">
                          <div>{entry.entry_date}</div>
                          <div className="mt-1">
                            {categoryLabel(entry.category)}
                          </div>
                          <div className="mt-1 font-medium text-slate-700">
                            ${formatCurrency(entry.amount)}
                          </div>
                        </div>

                        {entry.notes && (
                          <div className="mt-2 break-words text-slate-600">
                            {entry.notes}
                          </div>
                        )}

                        {isReviewedLocked && (
                          <div className="mt-3 text-xs text-slate-500">
                            Locked at {formatDate(entry.verified_at)}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start lg:flex-col lg:items-end">
                    {isReviewedLocked && (
                      <div className="group relative self-start lg:self-end">
                        <div
                          aria-label={
                            reviewer
                              ? `Reviewed and locked by ${reviewer.displayName}`
                              : "Reviewer not available"
                          }
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold ring-1 ${badgeColorClass}`}
                        >
                          {entry.verified_by_initials ||
                            reviewer?.initials ||
                            "--"}
                        </div>

                        <div className="pointer-events-none absolute left-0 top-12 z-10 hidden whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block sm:left-auto sm:right-0">
                          {reviewer
                            ? `Reviewed and locked by ${reviewer.displayName}`
                            : "Reviewer not available"}
                        </div>
                      </div>
                    )}

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:flex-col">
                      {!isReviewedLocked && !isEditing && (
                        <button
                          type="button"
                          onClick={() => beginEdit(entry)}
                          className="rounded-xl border px-4 py-2 text-sm font-medium"
                        >
                          Edit
                        </button>
                      )}

                      {isEditing && (
                        <>
                          <button
                            type="button"
                            disabled={savingEntryId === entry.id}
                            onClick={() => saveEditedEntry(entry.id)}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {savingEntryId === entry.id
                              ? "Saving..."
                              : "Save changes"}
                          </button>

                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-xl border px-4 py-2 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {!isReviewedLocked && !isEditing && (
                        <button
                          type="button"
                          disabled={savingEntryId === entry.id}
                          onClick={() => {
                            setConfirmMode("review");
                            setConfirmEntryId(entry.id);
                            setConfirmOpen(true);
                          }}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {savingEntryId === entry.id
                            ? "Saving..."
                            : "Review & lock"}
                        </button>
                      )}

                      {isReviewedLocked && canUnlock && (
                        <button
                          type="button"
                          disabled={savingEntryId === entry.id}
                          onClick={() => {
                            setConfirmMode("unlock");
                            setConfirmEntryId(entry.id);
                            setConfirmOpen(true);
                          }}
                          className="rounded-xl border px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
                        >
                          Unlock / remove review
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PageLayout>
  );
}
