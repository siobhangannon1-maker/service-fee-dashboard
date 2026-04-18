"use client";

import {
  ensureCurrentBillingPeriod,
  createNextBillingPeriodFromList,
} from "@/lib/billingPeriods";
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

export default function PatientEntriesPage() {
  const supabase = createClient();
const [search, setSearch] = useState("");
const [categoryFilter, setCategoryFilter] = useState("");
const [providerFilter, setProviderFilter] = useState("");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [materialItems, setMaterialItems] = useState<MaterialCostItem[]>([]);
  const [entries, setEntries] = useState<PatientFinancialEntry[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [activePeriodStatus, setActivePeriodStatus] = useState<"open" | "locked">(
    "open"
  );
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  async function loadData(periodId?: string) {
    setMessage("");

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
      .select("id, label, status")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (periodError) {
      setTone("error");
      setMessage(`Error loading billing periods: ${periodError.message}`);
      return;
    }

    const { data: materialData, error: materialError } = await supabase
      .from("material_cost_items")
      .select("id, name, default_cost, is_active, sort_order")
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

    const activePeriodId = periodId || selectedPeriodId || periodList[0]?.id || "";

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

    setEntries((entryData || []) as PatientFinancialEntry[]);

    setForm((prev) => ({
      ...prev,
      provider_id: prev.provider_id || providerList[0]?.id || "",
      billing_period_id: activePeriodId || "",
    }));
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relatedProviderOptions = useMemo(() => {
    return providers.filter((p) => p.id !== form.provider_id);
  }, [providers, form.provider_id]);

  function resetForm(nextPeriodId?: string) {
    setEditingEntryId(null);
    setSelectedMaterialId("");
    setForm({
      ...emptyForm,
      provider_id: providers[0]?.id || "",
      billing_period_id: nextPeriodId || selectedPeriodId || "",
    });
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

    const result = editingEntryId
      ? await supabase
          .from("patient_financial_entries")
          .update(payload)
          .eq("id", editingEntryId)
      : await supabase.from("patient_financial_entries").insert(payload);

    if (result.error) {
      setTone("error");
      setMessage(`Save failed: ${result.error.message}`);
      setSaving(false);
      return;
    }

    await writeAuditLog({
      action: editingEntryId ? "patient_entry_updated" : "patient_entry_created",
      entityType: "patient_financial_entry",
      entityId: editingEntryId,
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
  }

  async function softDeleteEntry(entryId: string) {
    setMessage("");

    if (activePeriodStatus === "locked") {
      setTone("error");
      setMessage("This billing period is locked.");
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
    <main className="min-h-screen bg-slate-50 p-6">
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

        <h1 className="text-3xl font-semibold">Patient Financial Entries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add, edit, and delete patient-level financial adjustments.
        </p>

        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm">Billing period</label>
          <select
            className="w-full rounded-2xl border bg-white px-3 py-2"
            value={selectedPeriodId}
            onChange={(e) => {
              const value = e.target.value;
              setSelectedPeriodId(value);
              setEditingEntryId(null);
              setSelectedMaterialId("");
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

        {activePeriodStatus === "locked" && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            This billing period is locked. Entries cannot be changed until it is reopened.
          </div>
        )}

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <form
          onSubmit={saveEntry}
          className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm">Provider</label>
              <select
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
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

            <div>
              <label className="mb-1 block text-sm">Billing period</label>
              <select
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                value={form.billing_period_id}
                onChange={(e) => {
                  const value = e.target.value;
                  const period = billingPeriods.find((p) => p.id === value);
                  setForm((prev) => ({ ...prev, billing_period_id: value }));
                  setActivePeriodStatus(
                    (period?.status as "open" | "locked") || "open"
                  );
                }}
                disabled={activePeriodStatus === "locked"}
              >
                <option value="">Select billing period</option>
                {billingPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm">Date</label>
              <input
                type="date"
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                value={form.entry_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, entry_date: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Patient name</label>
              <input
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                value={form.patient_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, patient_name: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Category</label>
              <select
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
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
              <div>
                <label className="mb-1 block text-sm">Material preset</label>
                <select
                  className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
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
                  disabled={activePeriodStatus === "locked"}
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
              <label className="mb-1 block text-sm">Amount</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                value={form.amount}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, amount: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
              />
            </div>

            {form.category === "paid_to_wrong_provider" && (
              <div>
                <label className="mb-1 block text-sm">Provider actually owed</label>
                <select
                  className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
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

            <div className="lg:col-span-3">
              <label className="mb-1 block text-sm">Notes</label>
              <input
                className="w-full rounded-2xl border px-3 py-2 disabled:bg-slate-100"
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                disabled={activePeriodStatus === "locked"}
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              disabled={saving || activePeriodStatus === "locked"}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
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
                className="ml-3 rounded-2xl border px-4 py-2"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-4 shadow-sm">
  <div className="grid gap-3 md:grid-cols-3">
    <input
      type="text"
      placeholder="Search patient or notes..."
      className="rounded-2xl border px-3 py-2"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />

    <select
      className="rounded-2xl border px-3 py-2"
      value={categoryFilter}
      onChange={(e) => setCategoryFilter(e.target.value)}
    >
      <option value="">All categories</option>
      <option value="lab_implant_materials">Lab / Implants / Materials</option>
      <option value="fees_paid_to_focus">Patient Fees Paid to Focus</option>
      <option value="fees_paid_in_error">Patient Fees Paid in Error</option>
      <option value="fees_owed">Patient Fees Owed</option>
      <option value="paid_to_wrong_provider">Paid to Wrong Provider</option>
    </select>

    <select
      className="rounded-2xl border px-3 py-2"
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

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Saved entries</h2>

          <div className="mt-4 space-y-3">
            {filteredEntries.length === 0 && (
  <div className="py-10 text-center text-sm text-slate-500">
    No matching entries found for this billing period.
  </div>
)}

{filteredEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border p-4 text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-medium">{entry.patient_name}</div>
                    <div className="text-slate-600">{providerName(entry.provider_id)}</div>
                    <div className="text-slate-500">
                      {entry.entry_date} · {categoryLabel(entry.category)} · $
                      {Number(entry.amount).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    {entry.related_provider_id && (
                      <div className="mt-1 text-slate-600">
                        Owed to: {providerName(entry.related_provider_id)}
                      </div>
                    )}
                    {entry.notes && (
                      <div className="mt-1 text-slate-600">{entry.notes}</div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(entry)}
                      disabled={activePeriodStatus === "locked"}
                      className="rounded-xl border px-3 py-1 disabled:opacity-50"
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
                      className="rounded-xl border px-3 py-1 text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}