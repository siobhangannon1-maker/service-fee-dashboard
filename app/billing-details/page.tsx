"use client";

import { useEffect, useState } from "react";
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

type DetailCategory = "humm_fee" | "afterpay_fee" | "incorrect_payment";

type BillingDetailEntry = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  patient_name: string | null;
  entry_date: string;
  category: DetailCategory;
  amount: number;
  notes: string | null;
  deleted_at?: string | null;
};

type DetailForm = {
  provider_id: string;
  billing_period_id: string;
  patient_name: string;
  entry_date: string;
  category: DetailCategory;
  amount: string;
  notes: string;
};

const emptyForm: DetailForm = {
  provider_id: "",
  billing_period_id: "",
  patient_name: "",
  entry_date: new Date().toISOString().slice(0, 10),
  category: "humm_fee",
  amount: "",
  notes: "",
};

export default function BillingDetailsPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [entries, setEntries] = useState<BillingDetailEntry[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [activePeriodStatus, setActivePeriodStatus] = useState<"open" | "locked">(
    "open"
  );
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  const [form, setForm] = useState<DetailForm>(emptyForm);

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

    const providerList = (providerData || []) as Provider[];
    const periodList = (periodData || []) as BillingPeriod[];

    setProviders(providerList);
    setBillingPeriods(periodList);

    const activePeriodId = periodId || selectedPeriodId || periodList[0]?.id || "";

    if (activePeriodId && activePeriodId !== selectedPeriodId) {
      setSelectedPeriodId(activePeriodId);
    }

    const activePeriod = periodList.find((p) => p.id === activePeriodId);
    setActivePeriodStatus((activePeriod?.status as "open" | "locked") || "open");

    let query = supabase
      .from("billing_detail_entries")
      .select("*")
      .is("deleted_at", null)
      .order("entry_date", { ascending: false });

    if (activePeriodId) {
      query = query.eq("billing_period_id", activePeriodId);
    }

    const { data: entryData, error: entryError } = await query;

    if (entryError) {
      setTone("error");
      setMessage(`Error loading detail entries: ${entryError.message}`);
      return;
    }

    setEntries((entryData || []) as BillingDetailEntry[]);

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

  function resetForm(nextPeriodId?: string) {
    setEditingEntryId(null);
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

    if (!form.provider_id || !form.billing_period_id) {
      setTone("error");
      setMessage("Please select a provider and billing period.");
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

    setSaving(true);

    const payload = {
      provider_id: form.provider_id,
      billing_period_id: form.billing_period_id,
      patient_name: form.patient_name.trim() || null,
      entry_date: form.entry_date,
      category: form.category,
      amount,
      notes: form.notes.trim() || null,
    };

    const result = editingEntryId
      ? await supabase
          .from("billing_detail_entries")
          .update(payload)
          .eq("id", editingEntryId)
      : await supabase.from("billing_detail_entries").insert(payload);

    if (result.error) {
      setTone("error");
      setMessage(`Save failed: ${result.error.message}`);
      setSaving(false);
      return;
    }

    await writeAuditLog({
      action: editingEntryId ? "billing_detail_updated" : "billing_detail_created",
      entityType: "billing_detail_entry",
      entityId: editingEntryId,
      billingPeriodId: form.billing_period_id,
      providerId: form.provider_id,
      metadata: {
        patient_name: form.patient_name,
        category: form.category,
        amount,
      },
    });

    setTone("success");
    setMessage(editingEntryId ? "Detail entry updated." : "Detail entry saved.");
    setSaving(false);
    resetForm(form.billing_period_id);
    await loadData(form.billing_period_id);
  }

  function beginEdit(entry: BillingDetailEntry) {
    setEditingEntryId(entry.id);
    setForm({
      provider_id: entry.provider_id,
      billing_period_id: entry.billing_period_id,
      patient_name: entry.patient_name || "",
      entry_date: entry.entry_date,
      category: entry.category,
      amount: String(entry.amount),
      notes: entry.notes || "",
    });

    const period = billingPeriods.find((p) => p.id === entry.billing_period_id);
    setActivePeriodStatus((period?.status as "open" | "locked") || "open");
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
      .from("billing_detail_entries")
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
      action: "billing_detail_deleted",
      entityType: "billing_detail_entry",
      entityId: entryId,
      billingPeriodId: selectedPeriodId,
    });

    setTone("success");
    setMessage("Detail entry deleted.");

    if (editingEntryId === entryId) {
      resetForm(selectedPeriodId);
    }

    await loadData(selectedPeriodId);
  }

  function categoryLabel(category: DetailCategory) {
    switch (category) {
      case "humm_fee":
        return "Humm Merchant Fee";
      case "afterpay_fee":
        return "Afterpay Merchant Fee";
      case "incorrect_payment":
        return "Incorrect Payment";
      default:
        return category;
    }
  }

  function providerName(id: string) {
    return providers.find((p) => p.id === id)?.name || "Unknown provider";
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <ConfirmDialog
          open={confirmOpen}
          title="Delete detail entry?"
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

        <h1 className="text-3xl font-semibold">Billing Detail Entries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add, edit, and delete merchant fee and incorrect payment entries.
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
                  setForm((prev) => ({ ...prev, provider_id: e.target.value }))
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
                    category: e.target.value as DetailCategory,
                  }))
                }
                disabled={activePeriodStatus === "locked"}
              >
                <option value="humm_fee">Humm Merchant Fee</option>
                <option value="afterpay_fee">Afterpay Merchant Fee</option>
                <option value="incorrect_payment">Incorrect Payment</option>
              </select>
            </div>

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
                ? "Update detail entry"
                : "Save detail entry"}
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

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Saved detail entries</h2>

          <div className="mt-4 space-y-3">
            {entries.length === 0 && (
              <div className="text-sm text-slate-500">No detail entries yet for this period.</div>
            )}

            {entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border p-4 text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-medium">
                      {entry.patient_name || "No patient name"}
                    </div>
                    <div className="text-slate-600">{providerName(entry.provider_id)}</div>
                    <div className="text-slate-500">
                      {entry.entry_date} · {categoryLabel(entry.category)} · $
                      {Number(entry.amount).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
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