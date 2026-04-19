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
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: Tier[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
  preview_fee_base?: number;
};

export default function ProvidersPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [message, setMessage] = useState("");

  async function loadProviders() {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .order("name");

    if (error) {
      setMessage(`Error loading providers: ${error.message}`);
      return;
    }

    setProviders((data || []) as Provider[]);
  }

  useEffect(() => {
    loadProviders();
  }, []);

  async function saveProvider(provider: Provider) {
    const { error } = await supabase
      .from("providers")
      .update({
        name: provider.name,
        specialty: provider.specialty,
        service_fee_percent: provider.service_fee_percent,
        service_fee_type: provider.service_fee_type,
        tier_config: provider.tier_config,
        deduct_adjustments: provider.deduct_adjustments,
        deduct_incorrect_payments: provider.deduct_incorrect_payments,
        deduct_iv_fees: provider.deduct_iv_fees,
        deduct_merchant_fees: provider.deduct_merchant_fees,
      })
      .eq("id", provider.id);

    setMessage(error ? `Save failed: ${error.message}` : "Saved.");
    if (!error) {
      loadProviders();
    }
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
          Edit provider names, formulas, and tier settings.
        </p>

        {message && (
          <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
            {message}
          </div>
        )}

        <div className="mt-6 space-y-4">
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
                      updateProvider(provider.id, { specialty: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm">Service fee type</label>
                  <select
                    className="w-full rounded-2xl border px-3 py-2"
                    value={provider.service_fee_type}
                    onChange={(e) =>
                      updateProvider(provider.id, {
                        service_fee_type: e.target.value as "flat" | "tiered",
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
                  <label className="mb-1 block text-sm">Preview fee base</label>
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

              <div className="mt-4">
                <button
                  onClick={() => saveProvider(provider)}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-white"
                >
                  Save provider
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}