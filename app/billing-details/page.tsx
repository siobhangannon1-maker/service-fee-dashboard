"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = {
  id: string;
  name: string;
};

type BillingPeriod = {
  id: string;
  label: string;
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
};

export default function BillingDetailsPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [entries, setEntries] = useState<BillingDetailEntry[]>([]);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    provider_id: "",
    billing_period_id: "",
    patient_name: "",
    entry_date: new Date().toISOString().slice(0, 10),
    category: "humm_fee" as DetailCategory,
    amount: "",
    notes: "",
  });

  async function loadData() {
    const { data: providerData, error: providerError } = await supabase
      .from("providers")
      .select("id, name")
      .order("name");

    if (providerError) {
      setMessage(`Error loading providers: ${providerError.message}`);
      return;
    }

    const { data: periodData, error: periodError } = await supabase
      .from("billing_periods")
      .select("id, label")
      .order("label");

    if (periodError) {
      setMessage(`Error loading billing periods: ${periodError.message}`);
      return;
    }

    const { data: entryData, error: entryError } = await supabase
      .from("billing_detail_entries")
      .select("*")
      .order("entry_date", { ascending: false });

    if (entryError) {
      setMessage(`Error loading detail entries: ${entryError.message}`);
      return;
    }

    setProviders((providerData || []) as Provider[]);
    setBillingPeriods((periodData || []) as BillingPeriod[]);
    setEntries((entryData || []) as BillingDetailEntry[]);

    if (!form.provider_id && providerData?.length) {
      setForm((prev) => ({ ...prev, provider_id: providerData[0].id }));
    }

    if (!form.billing_period_id && periodData?.length) {
      setForm((prev) => ({ ...prev, billing_period_id: periodData[0].id }));
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const amount = Number(form.amount) || 0;

    if (!form.provider_id || !form.billing_period_id) {
      setMessage("Please select a provider and billing period.");
      return;
    }

    const { error } = await supabase.from("billing_detail_entries").insert({
      provider_id: form.provider_id,
      billing_period_id: form.billing_period_id,
      patient_name: form.patient_name || null,
      entry_date: form.entry_date,
      category: form.category,
      amount,
      notes: form.notes || null,
    });

    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }

    setMessage("Detail entry saved.");
    setForm((prev) => ({
      ...prev,
      patient_name: "",
      amount: "",
      notes: "",
      category: "humm_fee",
    }));
    loadData();
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
        <h1 className="text-3xl font-semibold">Billing Detail Entries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter merchant fee and incorrect payment line items.
        </p>

        {message && (
          <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
            {message}
          </div>
        )}

        <form
          onSubmit={addEntry}
          className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm">Provider</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={form.provider_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, provider_id: e.target.value }))
                }
              >
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
                className="w-full rounded-2xl border px-3 py-2"
                value={form.billing_period_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    billing_period_id: e.target.value,
                  }))
                }
              >
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
                className="w-full rounded-2xl border px-3 py-2"
                value={form.entry_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, entry_date: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Patient name</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={form.patient_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, patient_name: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Category</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    category: e.target.value as DetailCategory,
                  }))
                }
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
                className="w-full rounded-2xl border px-3 py-2"
                value={form.amount}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, amount: e.target.value }))
                }
                required
              />
            </div>

            <div className="lg:col-span-3">
              <label className="mb-1 block text-sm">Notes</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="mt-4">
            <button className="rounded-2xl bg-slate-900 px-4 py-2 text-white">
              Save detail entry
            </button>
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Saved detail entries</h2>

          <div className="mt-4 space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border p-4 text-sm">
                <div className="font-medium">{entry.patient_name || "No patient name"}</div>
                <div className="text-slate-600">{providerName(entry.provider_id)}</div>
                <div className="text-slate-500">
                  {entry.entry_date} · {categoryLabel(entry.category)} · $
                  {Number(entry.amount).toLocaleString("en-AU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                {entry.notes && <div className="mt-1 text-slate-600">{entry.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}