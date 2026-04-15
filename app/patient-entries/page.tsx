"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = {
  id: string;
  name: string;
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

type PatientEntry = {
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

export default function PatientEntriesPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [entries, setEntries] = useState<PatientEntry[]>([]);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    provider_id: "",
    related_provider_id: "",
    billing_period_id: "",
    patient_name: "",
    entry_date: new Date().toISOString().slice(0, 10),
    category: "lab_implant_materials" as EntryCategory,
    amount: "",
    notes: "",
  });

  async function loadData(periodId?: string) {
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

    if (!form.provider_id && providerList.length) {
      setForm((prev) => ({ ...prev, provider_id: providerList[0].id }));
    }

    if (!form.billing_period_id && activePeriodId) {
      setForm((prev) => ({ ...prev, billing_period_id: activePeriodId }));
    }

    let entryQuery = supabase
      .from("patient_financial_entries")
      .select("*")
      .order("entry_date", { ascending: false });

    if (activePeriodId) {
      entryQuery = entryQuery.eq("billing_period_id", activePeriodId);
    }

    const { data: entryData, error: entryError } = await entryQuery;

    if (entryError) {
      setMessage(`Error loading entries: ${entryError.message}`);
      return;
    }

    setEntries((entryData || []) as PatientEntry[]);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const amount = Number(form.amount) || 0;

    if (!form.provider_id) {
      setMessage("Please select a provider.");
      return;
    }

    if (!form.billing_period_id) {
      setMessage("Please select a billing period.");
      return;
    }

    if (!form.patient_name.trim()) {
      setMessage("Please enter a patient name.");
      return;
    }

    if (form.category === "paid_to_wrong_provider" && !form.related_provider_id) {
      setMessage("Please select the provider who is actually owed the amount.");
      return;
    }

    if (
      form.category === "paid_to_wrong_provider" &&
      form.provider_id === form.related_provider_id
    ) {
      setMessage("Paid to provider and owed to provider cannot be the same.");
      return;
    }

    const { error } = await supabase.from("patient_financial_entries").insert({
      provider_id: form.provider_id,
      related_provider_id:
        form.category === "paid_to_wrong_provider"
          ? form.related_provider_id || null
          : null,
      billing_period_id: form.billing_period_id,
      patient_name: form.patient_name,
      entry_date: form.entry_date,
      category: form.category,
      amount,
      notes: form.notes || null,
    });

    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }

    setMessage("Entry saved.");
    setForm((prev) => ({
      ...prev,
      related_provider_id: "",
      patient_name: "",
      amount: "",
      notes: "",
      category: "lab_implant_materials",
    }));

    loadData(form.billing_period_id);
  }

  const totalsByProvider = useMemo(() => {
    const totals: Record<
      string,
      {
        lab_implant_materials: number;
        fees_paid_to_focus: number;
        fees_paid_in_error: number;
        fees_owed: number;
      }
    > = {};

    for (const provider of providers) {
      totals[provider.id] = {
        lab_implant_materials: 0,
        fees_paid_to_focus: 0,
        fees_paid_in_error: 0,
        fees_owed: 0,
      };
    }

    for (const entry of entries) {
      if (!totals[entry.provider_id]) {
        totals[entry.provider_id] = {
          lab_implant_materials: 0,
          fees_paid_to_focus: 0,
          fees_paid_in_error: 0,
          fees_owed: 0,
        };
      }

      const amount = Number(entry.amount || 0);

      if (entry.category === "lab_implant_materials") {
        totals[entry.provider_id].lab_implant_materials += amount;
      }

      if (entry.category === "fees_paid_to_focus") {
        totals[entry.provider_id].fees_paid_to_focus += amount;
      }

      if (entry.category === "fees_paid_in_error") {
        totals[entry.provider_id].fees_paid_in_error += amount;
      }

      if (entry.category === "fees_owed") {
        totals[entry.provider_id].fees_owed += amount;
      }

      if (entry.category === "paid_to_wrong_provider") {
        totals[entry.provider_id].fees_paid_in_error += amount;

        if (entry.related_provider_id) {
          if (!totals[entry.related_provider_id]) {
            totals[entry.related_provider_id] = {
              lab_implant_materials: 0,
              fees_paid_to_focus: 0,
              fees_paid_in_error: 0,
              fees_owed: 0,
            };
          }

          totals[entry.related_provider_id].fees_owed += amount;
        }
      }
    }

    return totals;
  }, [entries, providers]);

  function providerName(id: string | null) {
    if (!id) return "—";
    return providers.find((p) => p.id === id)?.name || "Unknown provider";
  }

  function categoryLabel(category: EntryCategory) {
    switch (category) {
      case "lab_implant_materials":
        return "Lab, Implants & Materials";
      case "fees_paid_to_focus":
        return "Patient Fees Paid to Focus";
      case "fees_paid_in_error":
        return "Patient Fees Paid in Error";
      case "fees_owed":
        return "Patient Fees Owed";
      case "paid_to_wrong_provider":
        return "Paid to Wrong Provider";
      default:
        return category;
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-semibold">Patient Financial Entries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add patient-linked costs and provider payment tracking entries.
        </p>

        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm">Billing period</label>
          <select
            className="w-full rounded-2xl border bg-white px-3 py-2"
            value={selectedPeriodId}
            onChange={(e) => {
              const value = e.target.value;
              setSelectedPeriodId(value);
              setForm((prev) => ({ ...prev, billing_period_id: value }));
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
              <label className="mb-1 block text-sm">Paid to provider</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={form.provider_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, provider_id: e.target.value }))
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
              <label className="mb-1 block text-sm">Billing period</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={form.billing_period_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, billing_period_id: e.target.value }))
                }
              >
                <option value="">Select billing period</option>
                {billingPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>

            {form.category === "paid_to_wrong_provider" && (
              <div>
                <label className="mb-1 block text-sm">Owed to provider</label>
                <select
                  className="w-full rounded-2xl border px-3 py-2"
                  value={form.related_provider_id}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      related_provider_id: e.target.value,
                    }))
                  }
                >
                  <option value="">Select provider</option>
                  {providers
                    .filter((provider) => provider.id !== form.provider_id)
                    .map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm">Patient name</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={form.patient_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, patient_name: e.target.value }))
                }
                required
              />
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
              <label className="mb-1 block text-sm">Category</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    category: e.target.value as EntryCategory,
                    related_provider_id: "",
                  }))
                }
              >
                <option value="lab_implant_materials">
                  Lab, Implants & Materials
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
              Save entry
            </button>
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Current totals by provider</h2>

          <div className="mt-4 space-y-4">
            {providers.map((provider) => {
              const totals = totalsByProvider[provider.id] || {
                lab_implant_materials: 0,
                fees_paid_to_focus: 0,
                fees_paid_in_error: 0,
                fees_owed: 0,
              };

              return (
                <div key={provider.id} className="rounded-2xl bg-slate-50 p-4">
                  <div className="font-medium">{provider.name}</div>

                  <div className="mt-2 grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
                    <div>
                      <div className="text-slate-500">Lab / Implant / Materials</div>
                      <div className="font-semibold">
                        $
                        {totals.lab_implant_materials.toLocaleString("en-AU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500">Paid to Focus</div>
                      <div className="font-semibold">
                        $
                        {totals.fees_paid_to_focus.toLocaleString("en-AU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500">Paid in Error</div>
                      <div className="font-semibold">
                        $
                        {totals.fees_paid_in_error.toLocaleString("en-AU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500">Fees Owed</div>
                      <div className="font-semibold">
                        $
                        {totals.fees_owed.toLocaleString("en-AU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Saved entries</h2>

          <div className="mt-4 space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border p-4 text-sm">
                <div className="font-medium">{entry.patient_name}</div>
                <div className="text-slate-600">
                  Paid to: {providerName(entry.provider_id)}
                </div>

                {entry.category === "paid_to_wrong_provider" && (
                  <div className="text-slate-600">
                    Owed to: {providerName(entry.related_provider_id)}
                  </div>
                )}

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
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}