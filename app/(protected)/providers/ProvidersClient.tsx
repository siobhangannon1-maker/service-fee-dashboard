"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateServiceFee } from "@/lib/calculations";

type Tier = {
  up_to: number | null;
  rate: number;
};

type Provider = {
  id: string;
  name: string;
  specialty: string;
  email: string | null;
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: Tier[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
  is_active: boolean;
  preview_fee_base?: number;
};

type NewProviderForm = {
  name: string;
  specialty: string;
  email: string;
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: Tier[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
};

export default function ProvidersPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [archivedProviders, setArchivedProviders] = useState<Provider[]>([]);
  const [message, setMessage] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [newProvider, setNewProvider] = useState<NewProviderForm>({
    name: "",
    specialty: "",
    email: "",
    service_fee_percent: 40,
    service_fee_type: "flat",
    tier_config: [
      { up_to: 83333, rate: 50 },
      { up_to: null, rate: 30 },
    ],
    deduct_adjustments: false,
    deduct_incorrect_payments: false,
    deduct_iv_fees: false,
    deduct_merchant_fees: false,
  });

  async function loadProviders() {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) {
      setMessage(`Error loading active providers: ${error.message}`);
      return;
    }

    setProviders((data || []) as Provider[]);
  }

  async function loadArchivedProviders() {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("is_active", false)
      .order("name");

    if (error) {
      setMessage(`Error loading archived providers: ${error.message}`);
      return;
    }

    setArchivedProviders((data || []) as Provider[]);
  }

  async function refreshAllProviders() {
    await Promise.all([loadProviders(), loadArchivedProviders()]);
  }

  useEffect(() => {
    refreshAllProviders();
  }, []);

  async function addProvider() {
    setMessage("");

    if (!newProvider.name.trim()) {
      setMessage("Please enter a provider name.");
      return;
    }

    if (!newProvider.specialty.trim()) {
      setMessage("Please enter a specialty.");
      return;
    }

    const insertPayload = {
      name: newProvider.name.trim(),
      specialty: newProvider.specialty.trim(),
      email: newProvider.email.trim() ? newProvider.email.trim() : null,
      service_fee_percent: newProvider.service_fee_percent,
      service_fee_type: newProvider.service_fee_type,
      tier_config:
        newProvider.service_fee_type === "tiered"
          ? newProvider.tier_config
          : null,
      deduct_adjustments: newProvider.deduct_adjustments,
      deduct_incorrect_payments: newProvider.deduct_incorrect_payments,
      deduct_iv_fees: newProvider.deduct_iv_fees,
      deduct_merchant_fees: newProvider.deduct_merchant_fees,
      is_active: true,
    };

    setIsAdding(true);

    const { error } = await supabase.from("providers").insert(insertPayload);

    setIsAdding(false);

    if (error) {
      setMessage(`Add failed: ${error.message}`);
      return;
    }

    setMessage("Provider added successfully.");

    setNewProvider({
      name: "",
      specialty: "",
      email: "",
      service_fee_percent: 40,
      service_fee_type: "flat",
      tier_config: [
        { up_to: 83333, rate: 50 },
        { up_to: null, rate: 30 },
      ],
      deduct_adjustments: false,
      deduct_incorrect_payments: false,
      deduct_iv_fees: false,
      deduct_merchant_fees: false,
    });

    refreshAllProviders();
  }

  async function saveProvider(provider: Provider) {
    const { error } = await supabase
      .from("providers")
      .update({
        name: provider.name,
        specialty: provider.specialty,
        email: provider.email?.trim() ? provider.email.trim() : null,
        service_fee_percent: provider.service_fee_percent,
        service_fee_type: provider.service_fee_type,
        tier_config:
          provider.service_fee_type === "tiered" ? provider.tier_config : null,
        deduct_adjustments: provider.deduct_adjustments,
        deduct_incorrect_payments: provider.deduct_incorrect_payments,
        deduct_iv_fees: provider.deduct_iv_fees,
        deduct_merchant_fees: provider.deduct_merchant_fees,
      })
      .eq("id", provider.id);

    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }

    setMessage("Saved.");
    refreshAllProviders();
  }

  async function archiveProvider(provider: Provider) {
    const confirmed = window.confirm(
      `Archive provider "${provider.name}"? They will be hidden from the active list but historical data will stay intact.`
    );

    if (!confirmed) {
      return;
    }

    setArchivingId(provider.id);
    setMessage("");

    const { data, error } = await supabase
      .from("providers")
      .update({ is_active: false })
      .eq("id", provider.id)
      .select("id, name, is_active");

    setArchivingId(null);

    if (error) {
      console.error("Archive provider error:", error);
      setMessage(
        `Archive failed: ${error.message} | code: ${error.code ?? "none"} | details: ${
          error.details ?? "none"
        } | hint: ${error.hint ?? "none"}`
      );
      return;
    }

    if (!data || data.length === 0) {
      setMessage(
        `Archive failed: no row was updated. This usually means Row Level Security is blocking the update.`
      );
      return;
    }

    setMessage(`Provider "${provider.name}" archived.`);
    refreshAllProviders();
  }

  async function restoreProvider(provider: Provider) {
    const confirmed = window.confirm(
      `Restore provider "${provider.name}" to the active list?`
    );

    if (!confirmed) {
      return;
    }

    setRestoringId(provider.id);
    setMessage("");

    const { data, error } = await supabase
      .from("providers")
      .update({ is_active: true })
      .eq("id", provider.id)
      .select("id, name, is_active");

    setRestoringId(null);

    if (error) {
      console.error("Restore provider error:", error);
      setMessage(
        `Restore failed: ${error.message} | code: ${error.code ?? "none"} | details: ${
          error.details ?? "none"
        } | hint: ${error.hint ?? "none"}`
      );
      return;
    }

    if (!data || data.length === 0) {
      setMessage(
        `Restore failed: no row was updated. This usually means Row Level Security is blocking the update.`
      );
      return;
    }

    setMessage(`Provider "${provider.name}" restored.`);
    refreshAllProviders();
  }

  function updateProvider(id: string, patch: Partial<Provider>) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold">Providers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Edit provider names, email addresses, formulas, and tier settings.
        </p>

        {message && (
          <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
            {message}
          </div>
        )}

        <div className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Add new provider</h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a new provider directly from this page.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Provider name</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={newProvider.name}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                placeholder="Dr Jane Smith"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Specialty</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={newProvider.specialty}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    specialty: e.target.value,
                  }))
                }
                placeholder="Dentist"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Email address</label>
              <input
                type="email"
                className="w-full rounded-2xl border px-3 py-2"
                value={newProvider.email}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
                placeholder="dr.jane@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Service fee type</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={newProvider.service_fee_type}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    service_fee_type: e.target.value as "flat" | "tiered",
                  }))
                }
              >
                <option value="flat">Flat</option>
                <option value="tiered">Tiered</option>
              </select>
            </div>

            {newProvider.service_fee_type === "flat" ? (
              <div>
                <label className="mb-1 block text-sm">Flat service fee %</label>
                <input
                  type="number"
                  className="w-full rounded-2xl border px-3 py-2"
                  value={newProvider.service_fee_percent}
                  onChange={(e) =>
                    setNewProvider((prev) => ({
                      ...prev,
                      service_fee_percent: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            ) : (
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm">Tier config (JSON)</label>
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border px-3 py-2 font-mono text-sm"
                  value={JSON.stringify(
                    newProvider.tier_config || [
                      { up_to: 83333, rate: 50 },
                      { up_to: null, rate: 30 },
                    ],
                    null,
                    2
                  )}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setNewProvider((prev) => ({
                        ...prev,
                        tier_config: parsed,
                      }));
                    } catch {
                      // Leave unsaved until valid JSON
                    }
                  }}
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newProvider.deduct_adjustments}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    deduct_adjustments: e.target.checked,
                  }))
                }
              />
              Deduct adjustments
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newProvider.deduct_incorrect_payments}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    deduct_incorrect_payments: e.target.checked,
                  }))
                }
              />
              Deduct incorrect payments
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newProvider.deduct_iv_fees}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    deduct_iv_fees: e.target.checked,
                  }))
                }
              />
              Deduct IV facility fees
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newProvider.deduct_merchant_fees}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    deduct_merchant_fees: e.target.checked,
                  }))
                }
              />
              Deduct merchant fees
            </label>
          </div>

          <div className="mt-4">
            <button
              onClick={addProvider}
              disabled={isAdding}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {isAdding ? "Adding..." : "Add provider"}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-2xl font-semibold">Active providers</h2>
          <p className="mt-1 text-sm text-slate-600">
            These providers are currently active and shown in your main list.
          </p>

          {providers.length === 0 ? (
            <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-slate-600">
              No active providers found.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="rounded-3xl border bg-white p-5 shadow-sm"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm">Provider name</label>
                      <input
                        className="w-full rounded-2xl border px-3 py-2"
                        value={provider.name}
                        onChange={(e) =>
                          updateProvider(provider.id, { name: e.target.value })
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Specialty</label>
                      <input
                        className="w-full rounded-2xl border px-3 py-2"
                        value={provider.specialty}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            specialty: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm">Email address</label>
                      <input
                        type="email"
                        className="w-full rounded-2xl border px-3 py-2"
                        value={provider.email || ""}
                        onChange={(e) =>
                          updateProvider(provider.id, { email: e.target.value })
                        }
                        placeholder="dr.jane@example.com"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">
                        Service fee type
                      </label>
                      <select
                        className="w-full rounded-2xl border px-3 py-2"
                        value={provider.service_fee_type}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            service_fee_type: e.target.value as
                              | "flat"
                              | "tiered",
                          })
                        }
                      >
                        <option value="flat">Flat</option>
                        <option value="tiered">Tiered</option>
                      </select>
                    </div>

                    {provider.service_fee_type === "flat" ? (
                      <div>
                        <label className="mb-1 block text-sm">
                          Flat service fee %
                        </label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border px-3 py-2"
                          value={provider.service_fee_percent}
                          onChange={(e) =>
                            updateProvider(provider.id, {
                              service_fee_percent: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-sm">
                          Tier config (JSON)
                        </label>
                        <textarea
                          className="min-h-[120px] w-full rounded-2xl border px-3 py-2 font-mono text-sm"
                          value={JSON.stringify(
                            provider.tier_config || [
                              { up_to: 83333, rate: 50 },
                              { up_to: null, rate: 30 },
                            ],
                            null,
                            2
                          )}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              updateProvider(provider.id, {
                                tier_config: parsed,
                              });
                            } catch {
                              // Leave unsaved until valid JSON
                            }
                          }}
                        />
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-sm">
                        Preview fee base
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-2xl border px-3 py-2"
                        value={provider.preview_fee_base || 0}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            preview_fee_base: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={provider.deduct_adjustments}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            deduct_adjustments: e.target.checked,
                          })
                        }
                      />
                      Deduct adjustments
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={provider.deduct_incorrect_payments}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            deduct_incorrect_payments: e.target.checked,
                          })
                        }
                      />
                      Deduct incorrect payments
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={provider.deduct_iv_fees}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            deduct_iv_fees: e.target.checked,
                          })
                        }
                      />
                      Deduct IV facility fees
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={provider.deduct_merchant_fees}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            deduct_merchant_fees: e.target.checked,
                          })
                        }
                      />
                      Deduct merchant fees
                    </label>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Calculated service fee preview
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      $
                      {calculateServiceFee(
                        provider,
                        provider.preview_fee_base || 0
                      ).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() => saveProvider(provider)}
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-white"
                    >
                      Save provider
                    </button>

                    <button
                      onClick={() => archiveProvider(provider)}
                      disabled={archivingId === provider.id}
                      className="rounded-2xl bg-red-600 px-4 py-2 text-white disabled:opacity-50"
                    >
                      {archivingId === provider.id
                        ? "Archiving..."
                        : "Archive provider"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10">
          <h2 className="text-2xl font-semibold">Archived providers</h2>
          <p className="mt-1 text-sm text-slate-600">
            These providers are hidden from the active list but can be restored.
          </p>

          {archivedProviders.length === 0 ? (
            <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-slate-600">
              No archived providers found.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {archivedProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="rounded-3xl border bg-slate-100 p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-lg font-semibold">
                        {provider.name}
                      </div>
                      <div className="text-sm text-slate-600">
                        {provider.specialty}
                      </div>
                      <div className="text-sm text-slate-600">
                        {provider.email || "No email address"}
                      </div>
                    </div>

                    <button
                      onClick={() => restoreProvider(provider)}
                      disabled={restoringId === provider.id}
                      className="rounded-2xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
                    >
                      {restoringId === provider.id
                        ? "Restoring..."
                        : "Restore provider"}
                    </button>
                  </div>

                  <div className="mt-4 text-sm text-slate-600">
                    Service fee type: <strong>{provider.service_fee_type}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}